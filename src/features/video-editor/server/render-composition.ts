import { spawn } from "node:child_process";
import { stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type RenderSegment = { inFrame: number; outFrame: number; startSeconds: number; endSeconds: number };

function run(executable: string, args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, signal });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(-1024 * 1024); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`媒体处理失败 (${code}): ${stderr}`)));
  });
}

export function compositionFilter(segments: RenderSegment[], audio: boolean) {
  if (!segments.length) throw new Error("成片至少需要一个片段");
  const count = segments.length;
  const parts: string[] = [];
  if (count > 1) parts.push(`[0:v:0]split=${count}${segments.map((_, i) => `[v${i}]`).join("")}`);
  if (audio && count > 1) parts.push(`[0:a:0]asplit=${count}${segments.map((_, i) => `[a${i}]`).join("")}`);
  for (const [index, segment] of segments.entries()) {
    const video = count > 1 ? `[v${index}]` : "[0:v:0]";
    parts.push(`${video}trim=start_frame=${segment.inFrame}:end_frame=${segment.outFrame},setpts=PTS-STARTPTS,settb=AVTB[vt${index}]`);
    if (audio) {
      const sound = count > 1 ? `[a${index}]` : "[0:a:0]";
      const duration = segment.endSeconds - segment.startSeconds;
      parts.push(`${sound}atrim=start=${segment.startSeconds}:end=${segment.endSeconds},asetpts=PTS-STARTPTS,apad,atrim=duration=${duration}[at${index}]`);
    }
  }
  const inputs = segments.map((_, i) => `[vt${i}]${audio ? `[at${i}]` : ""}`).join("");
  parts.push(`${inputs}concat=n=${count}:v=1:a=${audio ? 1 : 0}[vout]${audio ? "[aout]" : ""}`);
  return parts.join(";\n");
}

type Probe = { streams?: Array<{ codec_type?: string; nb_read_frames?: string; duration?: string; width?: number; height?: number }>;
  format?: { duration?: string } };

export async function renderComposition(source: string, target: string, segments: RenderSegment[], signal: AbortSignal) {
  const ffmpeg = join(process.cwd(), "data", "video-runtime", "tools", "ffmpeg.exe");
  const ffprobe = join(process.cwd(), "data", "video-runtime", "tools", "ffprobe.exe");
  const probeInput = JSON.parse(await run(ffprobe, ["-v", "error", "-show_entries", "stream=codec_type", "-of", "json", source], signal)) as Probe;
  const audio = Boolean(probeInput.streams?.some((stream) => stream.codec_type === "audio"));
  const script = join(dirname(target), "filter.txt");
  await writeFile(script, compositionFilter(segments, audio), "utf8");
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", source,
    "-/filter_complex", script, "-map", "[vout]", ...(audio ? ["-map", "[aout]"] : []),
    "-fps_mode:v", "vfr", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
    ...(audio ? ["-c:a", "aac", "-b:a", "192k"] : []), "-movflags", "+faststart", "-f", "mp4", target];
  await run(ffmpeg, args, signal);
  const probe = JSON.parse(await run(ffprobe, ["-v", "error", "-count_frames", "-show_entries",
    "stream=codec_type,nb_read_frames,duration,width,height:format=duration", "-of", "json", target], signal)) as Probe;
  const video = probe.streams?.find((stream) => stream.codec_type === "video");
  const actualFrames = Number(video?.nb_read_frames);
  const expectedFrames = segments.reduce((sum, segment) => sum + segment.outFrame - segment.inFrame, 0);
  const expectedDuration = segments.reduce((sum, segment) => sum + segment.endSeconds - segment.startSeconds, 0);
  const duration = Number(probe.format?.duration);
  const sound = probe.streams?.find((stream) => stream.codec_type === "audio");
  if (!video?.width || !video.height || actualFrames !== expectedFrames || !Number.isFinite(duration) ||
    Math.abs(duration - expectedDuration) > Math.max(.5, expectedDuration * .01) ||
    (audio && (!sound || Math.abs(Number(sound.duration) - duration) > .5)))
    throw new Error("成片帧数或音视频时长校验失败");
  const { size } = await stat(target);
  if (!size) throw new Error("成片文件为空");
  return { size, width: video.width, height: video.height, duration, frameCount: actualFrames, audio };
}

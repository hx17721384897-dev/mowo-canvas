import { createReadStream } from "node:fs";
import { Zip, ZipPassThrough } from "fflate";

export function cleanExportName(value: string) {
  return value.replace(/[\\/<>:"|?*\x00-\x1f]/g, "_").replace(/^[.\s]+|[.\s]+$/g, "").trim().slice(0, 100) || "未命名";
}

export function uniqueExportPath(path: string, used: Set<string>) {
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  const base = dot > slash ? path.slice(0, dot) : path;
  const extension = dot > slash ? path.slice(dot) : "";
  let candidate = path;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${base}_${suffix++}${extension}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

export function streamGroupZip(files: Array<{ path: string; name: string }>) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const zip = new Zip((error, data, final) => {
        if (closed) return;
        if (error) { closed = true; controller.error(error); return; }
        if (data.length) controller.enqueue(new Uint8Array(data));
        if (final) { closed = true; controller.close(); }
      });
      void (async () => {
        try {
          for (const file of files) {
            const member = new ZipPassThrough(file.name);
            zip.add(member);
            for await (const chunk of createReadStream(file.path)) member.push(new Uint8Array(chunk), false);
            member.push(new Uint8Array(0), true);
          }
          zip.end();
        } catch (error) {
          if (!closed) { closed = true; controller.error(error); }
        }
      })();
    },
  });
}

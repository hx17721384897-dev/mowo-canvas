/** Follow frames presented by the video, rather than the low-frequency timeupdate event. */
export function followVideoFrames(video: HTMLVideoElement, onFrame: (seconds: number) => void) {
  let active = true;
  let handle = 0;
  const useVideoFrames = typeof video.requestVideoFrameCallback === "function";
  const schedule = () => {
    if (!active) return;
    handle = useVideoFrames ? video.requestVideoFrameCallback((_now, metadata) => {
      if (!active) return;
      if (!video.paused && !video.seeking) onFrame(metadata.mediaTime);
      schedule();
    }) : requestAnimationFrame(() => {
      if (!active) return;
      if (!video.paused && !video.seeking) onFrame(video.currentTime);
      schedule();
    });
  };
  schedule();
  return () => {
    active = false;
    if (useVideoFrames) video.cancelVideoFrameCallback(handle);
    else cancelAnimationFrame(handle);
  };
}

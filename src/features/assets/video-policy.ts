export const VIDEO_MAX_BYTES = 500 * 1024 * 1024;
export const VIDEO_MAX_SECONDS = 5 * 60;
export const VIDEO_ACCEPT = ".mp4,.m4v,.mov,video/mp4,video/quicktime";
export function isLocalVideo(file: { name: string; type: string }) {
  return /\.(mp4|m4v|mov)$/i.test(file.name) || ["video/mp4", "video/quicktime", "video/x-m4v"].includes(file.type);
}
export function needsVideoEditor(size: number, duration: number) {
  return size > VIDEO_MAX_BYTES || duration > VIDEO_MAX_SECONDS;
}

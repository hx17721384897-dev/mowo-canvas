import { VideoTaskError } from "./task-store.ts";

export const videoReserveBytes = 256 * 1024 * 1024;
export function requireVideoSpace(available: number, additional = 0) {
  if (!Number.isFinite(available) || !Number.isFinite(additional) || additional < 0 || available < videoReserveBytes + additional) throw new VideoTaskError("DISK_FULL");
}

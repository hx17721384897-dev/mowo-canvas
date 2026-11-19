export type StitchSettings = { columns?: number; gap: number; margin: number; background: "transparent" | "white" };
export type StitchOutput = { id: string; name: string; width: number; height: number; previewUrl: string; derivationId: string };

const defaults = [0, 1, 2, 3, 2, 3, 3, 4, 4, 3, 4, 4, 4];

export function stitchLayout(count: number, cellWidth: number, cellHeight: number, settings: StitchSettings) {
  const ratio = cellWidth / cellHeight;
  const columns = settings.columns ?? (ratio >= 0.8 && ratio <= 1.25 && count <= 12
    ? defaults[count] : Math.max(1, Math.min(count, Math.round(Math.sqrt(count / ratio)))));
  const rows = Math.ceil(count / columns);
  const width = columns * cellWidth + (columns - 1) * settings.gap + 2 * settings.margin;
  const height = rows * cellHeight + (rows - 1) * settings.gap + 2 * settings.margin;
  const cells = Array.from({ length: count }, (_, index) => ({
    left: settings.margin + (index % columns) * (cellWidth + settings.gap),
    top: settings.margin + Math.floor(index / columns) * (cellHeight + settings.gap),
  }));
  return { gap: settings.gap, margin: settings.margin, background: settings.background, columns, rows, width, height, cellWidth, cellHeight, count, cells };
}

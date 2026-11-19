export type CropRect = { x: number; y: number; width: number; height: number };
export type CropRatioPreset = "free" | "1:1" | "16:9" | "4:3" | "3:2" | "9:16";
export type CropGrid = CropRect & { id: string; rows: number; columns: number; xs: number[]; ys: number[];
  cellAspectRatio?: number; ratioPreset?: CropRatioPreset };
export type CropItem = { id: string; rect: CropRect; zoom: number; dx: number; dy: number; durationMs: number };
export type CropPlan = {
  sourceAssetId: string; sourceUrl: string; sourceName: string; width: number; height: number;
  grids: CropGrid[]; items: CropItem[]; ordered: boolean;
  sizing?: "fixed" | "per-item";
  sources?: { assetId: string; url: string; width: number; height: number }[];
  output: { width: number; height: number; mode: "crop" | "pad" };
  generatedAssetIds?: string[];
};

export function cropOutputForItem(plan: CropPlan, item: CropItem): CropPlan["output"] {
  return plan.sizing === "per-item"
    ? { width: Math.max(1, Math.round(item.rect.width)), height: Math.max(1, Math.round(item.rect.height)), mode: "pad" }
    : plan.output;
}

export function equalCellGrid(grid: CropGrid, cellWidth: number, cellHeight: number): CropGrid {
  return { ...grid, width: cellWidth * grid.columns, height: cellHeight * grid.rows,
    xs: Array.from({ length: grid.columns - 1 }, (_, i) => (i + 1) / grid.columns),
    ys: Array.from({ length: grid.rows - 1 }, (_, i) => (i + 1) / grid.rows) };
}

export function resizeGridToCellRatio(grid: CropGrid, dimension: "width" | "height", value: number): CropGrid {
  const ratio = grid.cellAspectRatio;
  if (!ratio) return { ...grid, [dimension]: value };
  return dimension === "width"
    ? { ...grid, width: value, height: value * grid.rows / (grid.columns * ratio) }
    : { ...grid, height: value, width: value * grid.columns * ratio / grid.rows };
}

export function parseCellRatio(text: string): number | null {
  const parts = text.trim().replace(/[：∶]/g, ":").split(":").map((part) => Number(part.trim()));
  if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part) || part <= 0)) return null;
  const ratio = parts[0] / parts[1];
  return ratio >= .01 && ratio <= 100 ? ratio : null;
}

export function gridItems(grids: CropGrid[]): CropItem[] {
  return grids.flatMap((grid) => {
    const xs = [0, ...grid.xs, 1], ys = [0, ...grid.ys, 1];
    return Array.from({ length: grid.rows * grid.columns }, (_, index) => {
      const row = Math.floor(index / grid.columns), col = index % grid.columns;
      return { id: `${grid.id}-${row}-${col}`, rect: {
        x: grid.x + xs[col] * grid.width, y: grid.y + ys[row] * grid.height,
        width: (xs[col + 1] - xs[col]) * grid.width, height: (ys[row + 1] - ys[row]) * grid.height,
      }, zoom: 1, dx: 0, dy: 0, durationMs: 125 };
    });
  });
}

export function suggestedCropOutput(grid: CropGrid): CropPlan["output"] {
  const first = gridItems([grid])[0];
  return { width: Math.max(1, Math.round(first.rect.width)), height: Math.max(1, Math.round(first.rect.height)), mode: "pad" };
}

export function validCropPlan(value: unknown): value is CropPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Partial<CropPlan>;
  const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n);
  const rect = (r: CropRect) => r && [r.x, r.y, r.width, r.height].every(finite) && r.width > 0 && r.height > 0;
  const sizingValid = p.sizing === undefined || p.sizing === "fixed" || p.sizing === "per-item";
  const outputs = Array.isArray(p.items) && p.sizing === "per-item"
    ? p.items.map((item) => item && typeof item === "object" ? { width: Math.round(item.rect?.width), height: Math.round(item.rect?.height) } : { width: 0, height: 0 })
    : Array.isArray(p.items) ? p.items.map(() => p.output) : [];
  return typeof p.sourceAssetId === "string" && typeof p.sourceUrl === "string" && typeof p.sourceName === "string"
    && finite(p.width) && finite(p.height) && p.width! > 0 && p.height! > 0 && p.width! <= 100000 && p.height! <= 100000
    && typeof p.ordered === "boolean" && sizingValid && Array.isArray(p.grids) && p.grids.length <= 20
    && p.grids.every((g) => rect(g) && Math.abs(g.x) <= 100000 && Math.abs(g.y) <= 100000
      && g.width <= 100000 && g.height <= 100000
      && (g.cellAspectRatio === undefined || finite(g.cellAspectRatio) && g.cellAspectRatio >= .01 && g.cellAspectRatio <= 100)
      && (g.ratioPreset === undefined || ["free", "1:1", "16:9", "4:3", "3:2", "9:16"].includes(g.ratioPreset))
      && typeof g.id === "string" && Number.isInteger(g.rows) && Number.isInteger(g.columns)
      && g.rows >= 1 && g.columns >= 1 && g.rows * g.columns <= 500
      && Array.isArray(g.xs) && Array.isArray(g.ys) && g.xs.length === g.columns - 1 && g.ys.length === g.rows - 1
      && g.xs.every(finite) && g.ys.every(finite) && [0, ...g.xs, 1].every((n, i, a) => i === 0 || n > a[i - 1])
      && [0, ...g.ys, 1].every((n, i, a) => i === 0 || n > a[i - 1]))
    && Array.isArray(p.items) && p.items.length <= 500 && p.items.every((i) => i && typeof i === "object" && typeof i.id === "string" && rect(i.rect)
      && finite(i.zoom) && i.zoom > 0 && i.zoom <= 20 && finite(i.dx) && finite(i.dy)
      && Number.isInteger(i.durationMs) && i.durationMs >= 1 && i.durationMs <= 3600000)
    && (p.sources === undefined || Array.isArray(p.sources) && p.sources.length === p.items.length
      && p.sources.every((source) => source && typeof source === "object" && typeof source.assetId === "string" && typeof source.url === "string"
        && finite(source.width) && finite(source.height) && source.width > 0 && source.height > 0))
    && !!p.output && Number.isInteger(p.output.width) && Number.isInteger(p.output.height)
    && p.output.width > 0 && p.output.height > 0 && p.output.width <= 8192 && p.output.height <= 8192
    && outputs.every((size) => size && Number.isInteger(size.width) && Number.isInteger(size.height)
      && size.width >= 1 && size.height >= 1 && size.width <= 8192 && size.height <= 8192)
    && outputs.reduce((sum, size) => sum + size!.width * size!.height, 0) <= 100_000_000
    && (p.sizing !== "fixed" || p.grids.every((grid) => Math.abs(grid.width / grid.columns - p.output!.width) < .01
      && Math.abs(grid.height / grid.rows - p.output!.height) < .01
      && grid.xs.every((line, i) => Math.abs(line - (i + 1) / grid.columns) < .00001)
      && grid.ys.every((line, i) => Math.abs(line - (i + 1) / grid.rows) < .00001)))
    && (p.output.mode === "crop" || p.output.mode === "pad")
    && (p.generatedAssetIds === undefined || Array.isArray(p.generatedAssetIds) && p.generatedAssetIds.every((id) => typeof id === "string"));
}

export function renderCrop(image: HTMLImageElement, item: CropItem, output: CropPlan["output"], preview = false): HTMLCanvasElement {
  const ratio = preview ? Math.min(1, 240 / Math.max(output.width, output.height)) : 1;
  const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(output.width * ratio)); canvas.height = Math.max(1, Math.round(output.height * ratio));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器无法创建裁切画布");
  ctx.scale(ratio, ratio);
  const fit = output.mode === "pad" ? Math.min(output.width / item.rect.width, output.height / item.rect.height)
    : Math.max(output.width / item.rect.width, output.height / item.rect.height);
  const scale = fit * item.zoom;
  ctx.imageSmoothingQuality = "high";
  if (output.mode === "pad") {
    ctx.beginPath();
    ctx.rect((output.width - item.rect.width * fit) / 2, (output.height - item.rect.height * fit) / 2,
      item.rect.width * fit, item.rect.height * fit);
    ctx.clip();
  }
  ctx.drawImage(image, output.width / 2 - (item.rect.x + item.rect.width / 2) * scale + item.dx * output.width,
    output.height / 2 - (item.rect.y + item.rect.height / 2) * scale + item.dy * output.height,
    image.naturalWidth * scale, image.naturalHeight * scale);
  return canvas;
}

export async function loadCropImage(url: string) {
  const image = new Image(); image.src = url;
  await image.decode();
  return image;
}

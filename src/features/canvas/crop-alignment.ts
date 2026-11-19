import type { CropGrid } from "./image-crop";

export type CropGuides = { x?: number; y?: number };

type Axis = "x" | "y";
type SnapMode = "move" | "resize";

function snapAxis(position: number, size: number, sourceSize: number, otherGrids: CropGrid[], axis: Axis,
  mode: SnapMode, tolerance: number): { position: number; guide?: number } {
  const length = axis === "x" ? "width" : "height";
  const candidates = mode === "resize" ? [{ value: position + size, offset: size }]
    : [{ value: position, offset: 0 }, { value: position + size / 2, offset: size / 2 },
      { value: position + size, offset: size }];
  const otherTargets = otherGrids.flatMap((grid) => [grid[axis], grid[axis] + grid[length] / 2,
    grid[axis] + grid[length]]);
  let best: { position: number; guide: number; distance: number } | undefined;
  candidates.forEach((candidate, index) => {
    const sourceTargets = mode === "resize" ? [0, sourceSize / 2, sourceSize]
      : [index === 0 ? 0 : index === 1 ? sourceSize / 2 : sourceSize];
    for (const guide of [...sourceTargets, ...otherTargets]) {
      const distance = Math.abs(candidate.value - guide);
      if (distance <= tolerance && (!best || distance < best.distance)) {
        best = { position: guide - candidate.offset, guide, distance };
      }
    }
  });
  return best ? { position: best.position, guide: best.guide } : { position };
}

/** Coordinates stay in source pixels; tolerance is converted from screen pixels by the caller. */
export function snapCropGrid(grid: CropGrid, source: { width: number; height: number },
  others: CropGrid[], mode: SnapMode, tolerance: number): { grid: CropGrid; guides: CropGuides } {
  const x = snapAxis(grid.x, grid.width, source.width, others, "x", mode, tolerance);
  const y = snapAxis(grid.y, grid.height, source.height, others, "y", mode, tolerance);
  return mode === "resize"
    ? { grid: { ...grid, width: x.position - grid.x + grid.width,
      height: y.position - grid.y + grid.height }, guides: { x: x.guide, y: y.guide } }
    : { grid: { ...grid, x: x.position, y: y.position }, guides: { x: x.guide, y: y.guide } };
}

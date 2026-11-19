import assert from "node:assert/strict";
import { cropOutputForItem, equalCellGrid, gridItems, parseCellRatio, renderCrop, resizeGridToCellRatio, suggestedCropOutput, validCropPlan, type CropGrid, type CropPlan } from "./image-crop.ts";
import { snapCropGrid } from "./crop-alignment.ts";

const grids: CropGrid[] = [
  { id: "top", x: 0, y: 0, width: 300, height: 100, rows: 1, columns: 3, xs: [1 / 3, 2 / 3], ys: [] },
  { id: "bottom", x: 0, y: 100, width: 300, height: 100, rows: 1, columns: 2, xs: [.5], ys: [] },
];
const sourceBounds = { width: 300, height: 200 };
assert.deepEqual(snapCropGrid({ ...grids[0], x: 6, y: -5 }, sourceBounds, [], "move", 8).guides,
  { x: 0, y: 0 }, "移回原图边缘时显示两条对齐线");
assert.deepEqual(snapCropGrid({ ...grids[0], x: 6, y: -5 }, sourceBounds, [], "move", 8).grid,
  { ...grids[0], x: 0, y: 0 });
assert.equal(snapCropGrid({ ...grids[0], x: 15 }, sourceBounds, [], "move", 8).grid.x, 15,
  "超出吸附距离后仍能自由移动");
assert.equal(snapCropGrid({ ...grids[0], width: 294 }, sourceBounds, [], "resize", 8).grid.width, 300,
  "拖角时右边缘吸附原图右边缘");
assert.equal(snapCropGrid({ ...grids[0], x: 307 }, sourceBounds, [grids[0]], "move", 8).grid.x, 300,
  "不同网格可边缘对齐");
const items = gridItems(grids);
assert.equal(items.length, 5);
assert.deepEqual(items.map((item) => item.rect.y), [0, 0, 0, 100, 100]);
assert.equal(items[3].rect.width, 150);
const twoByFour = gridItems([{ id: "two-by-four", x: 0, y: 0, width: 624, height: 624,
  rows: 2, columns: 4, xs: [.25, .5, .75], ys: [.5] }]);
assert.equal(twoByFour[0].rect.width, 156);
assert.equal(twoByFour[0].rect.height, 312);
assert.equal(twoByFour[0].rect.width / twoByFour[0].rect.height, .5, "显示单格比例应为 1∶2，而不是整个网格的 1∶1");
assert.deepEqual(suggestedCropOutput({ id: "two-by-four", x: 0, y: 0, width: 1520, height: 624,
  rows: 2, columns: 4, xs: [.25, .5, .75], ys: [.5] }), { width: 380, height: 312, mode: "pad" });

const plan: CropPlan = { sourceAssetId: "source", sourceUrl: "/source.png", sourceName: "source.png",
  width: 300, height: 200, grids, items, ordered: false, output: { width: 100, height: 100, mode: "pad" } };
assert.equal(validCropPlan(plan), true);
assert.equal(validCropPlan({ ...plan, grids: [{ ...grids[0], cellAspectRatio: 16 / 9, ratioPreset: "16:9" }] }), true,
  "比例预设可随裁切方案保存");
assert.equal(validCropPlan({ ...plan, grids: [{ ...grids[0], ratioPreset: "unknown" }] }), false,
  "未知比例预设不能写入画布文档");
assert.equal(validCropPlan({ ...plan, output: { ...plan.output, mode: "crop" } }), true,
  "旧裁切草稿的铺满模式仍可安全读取");
const fixedGrid = equalCellGrid({ ...grids[1], columns: 2 }, 128, 96);
assert.equal(parseCellRatio("3:2"), 1.5);
assert.equal(parseCellRatio("1：1"), 1);
assert.equal(parseCellRatio("0:2"), null);
assert.equal(parseCellRatio("3:0"), null);
assert.equal(parseCellRatio("无法识别"), null);
const ratioGrid = { ...fixedGrid, rows: 2, columns: 4, cellAspectRatio: 1 };
assert.equal(resizeGridToCellRatio(ratioGrid, "width", 800).height, 400,
  "设为 1:1 后，2 行 4 列网格的总宽高应为 2:1");
assert.equal(resizeGridToCellRatio(ratioGrid, "height", 500).width, 1000,
  "按高度调整也要带动宽度");
assert.deepEqual([fixedGrid.width, fixedGrid.height, fixedGrid.xs, fixedGrid.ys], [256, 96, [.5], []]);
assert.equal(validCropPlan({ ...plan, sizing: "fixed", grids: [fixedGrid], items: gridItems([fixedGrid]),
  output: { width: 128, height: 96, mode: "pad" } }), true);
assert.equal(validCropPlan({ ...plan, sizing: "fixed", grids: [fixedGrid], items: gridItems([fixedGrid]),
  output: { width: 127, height: 96, mode: "pad" } }), false);
const varyingPlan: CropPlan = { ...plan, sizing: "per-item", output: { width: 100, height: 100, mode: "pad" } };
assert.deepEqual(cropOutputForItem(varyingPlan, items[0]), { width: 100, height: 100, mode: "pad" });
assert.deepEqual(cropOutputForItem(varyingPlan, items[3]), { width: 150, height: 100, mode: "pad" });
assert.equal(validCropPlan(varyingPlan), true);
assert.equal(validCropPlan({ ...varyingPlan, items: [{ ...items[0], rect: { ...items[0].rect, width: 9000 } }] }), false);
assert.equal(validCropPlan({ ...plan, grids: [{ ...grids[1], y: 150 }] }), true, "网格可延伸到原图之外");
assert.equal(validCropPlan({ ...plan, grids: [{ ...grids[0], x: -40 }] }), true, "网格可移到原图左侧");
assert.equal(validCropPlan({ ...plan, grids: [{ ...grids[0], x: -500000 }] }), false, "越界坐标仍受资源上限约束");
assert.equal(validCropPlan({ ...plan, output: { ...plan.output, width: -1 } }), false);
assert.equal(validCropPlan({ ...plan, items: [null] }), false);
assert.equal(validCropPlan({ ...plan, sources: [null, ...items.slice(1).map(() => ({ assetId: "source", url: "/source.png", width: 300, height: 200 }))] }), false);
assert.equal(validCropPlan({ ...plan, sources: [{ assetId: "source", url: "/source.png", width: 300, height: 200 }] }), false);
assert.equal(validCropPlan({ ...plan, grids: [], sources: items.map(() => ({ assetId: "source", url: "/source.png", width: 300, height: 200 })) }), true);

// 补透明边时，图片只能绘入当前小格的目标区域，不能把旁边小格画进留白。
let clippingRect: number[] | undefined;
let drawnAt: number[] | undefined;
const oldDocument = globalThis.document;
globalThis.document = { createElement: () => ({ getContext: () => ({
  scale: () => {}, beginPath: () => {}, rect: (...values: number[]) => { clippingRect = values; }, clip: () => {},
  drawImage: (_image: unknown, ...values: number[]) => { drawnAt = values; }, imageSmoothingQuality: "low",
}) }) } as unknown as Document;
try {
  renderCrop({ naturalWidth: 1520, naturalHeight: 624 } as HTMLImageElement,
    { id: "first", rect: { x: 0, y: 0, width: 380, height: 312 }, zoom: 1, dx: 0, dy: 0, durationMs: 125 },
    { width: 760, height: 312, mode: "pad" });
  assert.deepEqual(clippingRect, [190, 0, 380, 312]);
  renderCrop({ naturalWidth: 1520, naturalHeight: 624 } as HTMLImageElement,
    { id: "second", rect: { x: 380, y: 0, width: 380, height: 312 }, zoom: 1, dx: 0, dy: 0, durationMs: 125 },
    { width: 380, height: 312, mode: "pad" });
  assert.deepEqual(clippingRect, [0, 0, 380, 312]);
  assert.deepEqual(drawnAt, [-380, 0, 1520, 624], "第二格应从源图第 380 像素开始，不应使用第一格的位置");
  renderCrop({ naturalWidth: 100, naturalHeight: 100 } as HTMLImageElement,
    { id: "outside", rect: { x: -50, y: 0, width: 100, height: 100 }, zoom: 1, dx: 0, dy: 0, durationMs: 125 },
    { width: 100, height: 100, mode: "pad" });
  assert.deepEqual(drawnAt, [50, 0, 100, 100], "原图外侧保持透明，原图从输出画面的第 50 像素开始");
} finally { globalThis.document = oldDocument; }

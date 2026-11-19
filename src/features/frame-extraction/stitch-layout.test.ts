import assert from "node:assert/strict";
import sharp from "sharp";
import { stitchLayout } from "./stitch-layout.ts";
import { renderStitch } from "./server/render-stitch.ts";

const settings = { gap: 1, margin: 1, background: "transparent" as const };
assert.deepEqual(Array.from({ length: 11 }, (_, index) => stitchLayout(index + 2, 4, 4, settings).columns),
  [2, 3, 2, 3, 3, 4, 4, 3, 4, 4, 4]);
const layout = stitchLayout(3, 2, 2, { ...settings, columns: 2 });
assert.deepEqual([layout.width, layout.height], [7, 7]);
const inputs = await Promise.all(["#ff0000", "#00ff00", "#0000ff"].map((background) =>
  sharp({ create: { width: 2, height: 2, channels: 4, background } }).png().toBuffer()));
const pixels = await sharp(await renderStitch(layout, inputs)).ensureAlpha().raw().toBuffer();
const pixel = (x: number, y: number) => [...pixels.subarray((y * layout.width + x) * 4, (y * layout.width + x) * 4 + 4)];
assert.deepEqual(pixel(1, 1), [255, 0, 0, 255]);
assert.deepEqual(pixel(4, 1), [0, 255, 0, 255]);
assert.deepEqual(pixel(1, 4), [0, 0, 255, 255]);
assert.equal(pixel(4, 4)[3], 0);
assert.equal(pixel(3, 1)[3], 0);
console.log("Frame stitch layout and PNG tests passed");

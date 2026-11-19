import assert from "node:assert/strict";
import test from "node:test";
import { cuttingDuration, cuttingTimeForSource, locateCuttingTime, moveCuttingClip, removeCuttingClip,
  splitCuttingClip, trimCuttingClip, type CuttingClip } from "./cutting-model.ts";

test("reordered clips map composition time to the original source without moving source cuts", () => {
  const times = Array.from({ length: 300 }, (_, frame) => frame / 30);
  const clips: CuttingClip[] = [
    { id: "a", sourceAssetId: "source", inFrame: 0, outFrame: 100 },
    { id: "c", sourceAssetId: "source", inFrame: 200, outFrame: 300 },
    { id: "b", sourceAssetId: "source", inFrame: 120, outFrame: 180 },
  ];
  assert.equal(cuttingDuration(clips, times, 10), 260 / 30);
  assert.deepEqual(locateCuttingTime(clips, times, 10, 100 / 30),
    { clipId: "c", sourceFrame: 200, sourceSeconds: 200 / 30, cuttingSeconds: 100 / 30 });
  const moved = locateCuttingTime(clips, times, 10, 200 / 30);
  assert.equal(moved?.clipId, "b");
  assert.equal(moved?.sourceFrame, 120);
  assert.ok(Math.abs((moved?.sourceSeconds ?? 0) - 4) < 1e-9);
});

test("duplicate source ranges remain distinct by clip identity", () => {
  const times = [0, .04, .12, .2, .4];
  const clips: CuttingClip[] = [
    { id: "first", sourceAssetId: "source", inFrame: 1, outFrame: 4 },
    { id: "again", sourceAssetId: "source", inFrame: 1, outFrame: 4 },
  ];
  assert.ok(Math.abs((cuttingTimeForSource(clips, times, .5, "first", .12) ?? 0) - .08) < 1e-9);
  assert.ok(Math.abs((cuttingTimeForSource(clips, times, .5, "again", .12) ?? 0) - .44) < 1e-9);
  assert.equal(locateCuttingTime(clips, times, .5, .44)?.clipId, "again");
  assert.equal(locateCuttingTime(clips, times, .5, 100)?.sourceFrame, 3);
});

test("split, trim, remove and reorder change only the composition sequence", () => {
  const original: CuttingClip = { id: "a", sourceAssetId: "source", inFrame: 0, outFrame: 12 };
  const split = splitCuttingClip([original], "a", 5, "b");
  assert.deepEqual(split.map((clip) => [clip.id, clip.inFrame, clip.outFrame]), [["a", 0, 5], ["b", 5, 12]]);
  const trimmed = trimCuttingClip(split, "b", "in", 7);
  assert.deepEqual(trimmed.map((clip) => [clip.inFrame, clip.outFrame]), [[0, 5], [7, 12]]);
  const moved = moveCuttingClip(trimmed, "b", 0);
  assert.deepEqual(moved.map((clip) => clip.id), ["b", "a"]);
  assert.deepEqual(removeCuttingClip(moved, "a").map((clip) => clip.id), ["b"]);
  assert.deepEqual(original, { id: "a", sourceAssetId: "source", inFrame: 0, outFrame: 12 });
  assert.equal(splitCuttingClip([original], "a", 0, "invalid")[0], original);
});

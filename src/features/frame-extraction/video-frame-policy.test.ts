import assert from "node:assert/strict";
import { planSampledFrames, sampledFrameCount, validateVideoFrameRange, videoOutputIssue, VIDEO_FRAME_LIMITS } from "./video-frame-policy.ts";

assert.deepEqual(validateVideoFrameRange(60, VIDEO_FRAME_LIMITS.maxBytes), []);
assert.deepEqual(validateVideoFrameRange(60.001, VIDEO_FRAME_LIMITS.maxBytes + 1), ["DURATION_LIMIT", "SIZE_LIMIT"]);
assert.deepEqual(validateVideoFrameRange(5, null), []); // Large original isn't used to reject a clip.
assert.deepEqual(validateVideoFrameRange(NaN, -1), ["INVALID_DURATION", "INVALID_SIZE"]);
assert.equal(sampledFrameCount(600, { every: 4, keep: 1 }), 150);
assert.equal(sampledFrameCount(601, { every: 4, keep: 1 }), 151);
assert.equal(sampledFrameCount(8, { every: 3, keep: 2 }), 6);
assert.equal(videoOutputIssue(150), null);
assert.equal(videoOutputIssue(151), "OUTPUT_LIMIT");
assert.equal(videoOutputIssue(0), "EMPTY_SEQUENCE");
assert.throws(() => sampledFrameCount(4, { every: 2, keep: 3 }));
assert.throws(() => planSampledFrames(Array.from({ length: 151 }, (_, i) => i), 151, { every: 1, keep: 1 }), /OUTPUT_LIMIT/);
const result = planSampledFrames([2, 2.02, 2.07, 2.1, 2.14], 2.17, { every: 3, keep: 2 });
assert.deepEqual(result.map((frame) => frame.inputPosition), [0, 1, 3, 4]);
assert.ok(Math.abs(result.reduce((sum, frame) => sum + frame.durationSeconds, 0) - 0.17) < 1e-10);
assert.throws(() => planSampledFrames([0, 0], 1, { every: 1, keep: 1 }));
console.log("Video frame policy tests passed");

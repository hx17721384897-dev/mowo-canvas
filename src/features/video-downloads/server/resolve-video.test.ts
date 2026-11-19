import assert from "node:assert/strict";
import test from "node:test";
import { resolvedVideo } from "./resolve-video.ts";

const format = { ext: "mp4", width: 1920, height: 1080, fps: 30, acodec: "none", filesize: null, filesize_approx: null, tbr: 1000, format_note: null };
const sample = { sourceUrl: "https://www.bilibili.com/video/BV1bv411T7et?p=2", bvid: "BV1bv411T7et", part: 2, cid: "123", title: "样本", duration: 10, cover: "https://evil.test/secret",
  pages: [{ part: 1, title: "第一 P", duration: 20 }, { part: 2, title: "第二 P", duration: 10 }],
  formats: [{ ...format, format_id: "hevc", vcodec: "hev1", height: 2160 }, { ...format, format_id: "avc", vcodec: "avc1" },
    { ...format, format_id: "audio", vcodec: "none", acodec: "mp4a.40.2", height: null, width: null }] };

test("format choices prefer compatible video plus audio and retain selected P with unknown size", () => {
  const { video } = resolvedVideo(sample);
  assert.equal(video.part, 2); assert.equal(video.cover, null);
  assert.deepEqual(video.choices[0].formatIds, ["avc", "audio"]);
  assert.equal(video.choices[0].size, null); assert.equal(video.choices[0].requireAudio, true);
  assert.ok(!JSON.stringify(video).includes("evil.test"));
});
test("silent video stays silent and mismatched source identity is rejected", () => {
  const { video } = resolvedVideo({ ...sample, formats: [sample.formats[1]] });
  assert.equal(video.choices[0].requireAudio, false); assert.deepEqual(video.choices[0].formatIds, ["avc"]);
  assert.throws(() => resolvedVideo({ ...sample, part: 1 }));
  assert.throws(() => resolvedVideo({ ...sample, formats: [] }));
});

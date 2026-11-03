import assert from "node:assert/strict";
import { isAnimatedPng, makeApngLoopForever } from "./apng.ts";

function finiteLoopApng() {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const control = Buffer.alloc(20);
  control.writeUInt32BE(8, 0);
  control.write("acTL", 4, "ascii");
  control.writeUInt32BE(8, 8);
  control.writeUInt32BE(4, 12);
  return Buffer.concat([signature, control]);
}

const source = finiteLoopApng();
const normalized = makeApngLoopForever(source);

assert.equal(isAnimatedPng(source), true);
assert.equal(source.readUInt32BE(20), 4);
assert.equal(normalized.readUInt32BE(20), 0);
assert.equal(normalized.readUInt32BE(24), 0xb93d8bd1);
assert.deepEqual(makeApngLoopForever(normalized), normalized);

console.log("APNG loop normalization tests passed");

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { unzipSync } from "fflate";
import { cleanExportName, streamGroupZip, uniqueExportPath } from "./group-export-zip.ts";

const used = new Set<string>();
assert.deepEqual([uniqueExportPath("图/同名.png", used), uniqueExportPath("图/同名.png", used)], ["图/同名.png", "图/同名_2.png"]);
assert.equal(cleanExportName("../坏\\名?.zip"), "_坏_名_.zip");
const root = await mkdtemp(join(tmpdir(), "mowo-group-zip-"));
try {
  const first = join(root, "first.png");
  const second = join(root, "second.png");
  await writeFile(first, "first-original");
  await writeFile(second, "second-original");
  const data = new Uint8Array(await new Response(streamGroupZip([
    { path: first, name: "01_动作/001.png" }, { path: second, name: "01_动作/002.png" },
  ])).arrayBuffer());
  const zip = unzipSync(data);
  assert.equal(new TextDecoder().decode(zip["01_动作/001.png"]), "first-original");
  assert.equal(new TextDecoder().decode(zip["01_动作/002.png"]), "second-original");
  console.log("Group ZIP tests passed");
} finally {
  if (relative(resolve(tmpdir()), resolve(root)).startsWith("mowo-group-zip-")) await rm(root, { recursive: true, force: true });
}

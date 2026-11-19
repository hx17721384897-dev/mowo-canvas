import assert from "node:assert/strict";
import { imageImportOrder } from "./image-import-order.ts";

assert.deepEqual(imageImportOrder(["walk_10.png", "walk_2.png", "walk_1.png"]), [2, 1, 0]);
assert.deepEqual(imageImportOrder(["12.png", "2.png"]), [1, 0]);
assert.equal(imageImportOrder(["cat1.png", "dog2.png"]), null);
assert.equal(imageImportOrder(["cat1.png", "cat1.jpg"]), null);
assert.equal(imageImportOrder(["cat.png", "cat2.png"]), null);
console.log("Image import order tests passed");

import { normalizeQuickActions, moveQuickAction } from "./quick-actions.ts";
import assert from "node:assert/strict";
import { copyGroupActionLayout, defaultGroupActionLayout, moveGroupAction, moveGroupActionAt, stepGroupAction, validGroupActionLayout } from "./group-quick-actions.ts";

const original = copyGroupActionLayout();
assert.ok(validGroupActionLayout(original));
const hidden = moveGroupAction(original, "delete", "more");
assert.deepEqual(hidden.more, ["toggle-scale", "toggle-order", "delete"]);
assert.ok(!hidden.toolbar.includes("delete"));
assert.deepEqual(original, defaultGroupActionLayout, "移动操作不能更改默认布局");
const pinned = moveGroupAction(hidden, "toggle-order", "toolbar", "arrange");
assert.equal(pinned.toolbar[0], "toggle-order");
assert.deepEqual(stepGroupAction(pinned, "toggle-order", 1).toolbar.slice(0, 2), ["arrange", "toggle-order"]);
assert.equal(stepGroupAction(pinned, "toggle-order", -1), pinned);
assert.deepEqual(moveGroupActionAt(original, "toggle-scale", "toolbar", 1).toolbar.slice(0, 3), ["arrange", "toggle-scale", "preview"]);
assert.deepEqual(moveGroupActionAt(original, "arrange", "toolbar", 3).toolbar.slice(0, 3), ["preview", "toggle-collapse", "arrange"]);
assert.deepEqual(moveGroupActionAt(original, "delete", "more", 0).more, ["delete", "toggle-scale", "toggle-order"]);
const legacy = { toolbar: ["arrange", "preview", "toggle-collapse", "ungroup", "delete"], more: ["toggle-order"] } as typeof original;
assert.ok(validGroupActionLayout(legacy));
assert.deepEqual(copyGroupActionLayout(legacy).more, ["toggle-scale", "toggle-order"]);
assert.equal(validGroupActionLayout({ toolbar: ["arrange", "preview", "toggle-collapse", "ungroup", "delete", "toggle-scale"], more: [] }), false);
assert.equal(validGroupActionLayout({ toolbar: ["arrange", "arrange"], more: [] }), false);
assert.equal(validGroupActionLayout({ toolbar: ["arrange"], more: ["unknown"] }), false);
console.log("Canvas group quick action layout tests passed");

const actionDefaults = [
  { id: "arrange", defaultShowLabel: true },
  { id: "delete" },
  { id: "future-video-export", defaultZone: "more" as const, defaultShowLabel: true },
];
const legacySettings = { toolbar: ["delete", "arrange"], more: [] };
const migrated = normalizeQuickActions(actionDefaults, legacySettings);
assert.deepEqual(migrated.toolbar, ["delete", "arrange"]);
assert.deepEqual(migrated.more, ["future-video-export"]);
assert.deepEqual(migrated.showLabels, { arrange: true, delete: false, "future-video-export": true });
const customized = { ...migrated, showLabels: { ...migrated.showLabels, arrange: false } };
const movedSettings = moveQuickAction(customized, "arrange", "more", 0);
assert.deepEqual(movedSettings.more, ["arrange", "future-video-export"]);
assert.equal(movedSettings.showLabels.arrange, false);
assert.deepEqual(customized.toolbar, ["delete", "arrange"]);
const future = normalizeQuickActions([...actionDefaults, { id: "new-action" }], movedSettings);
assert.equal(future.showLabels.arrange, false);
assert.ok(future.toolbar.includes("new-action"));
const repaired = normalizeQuickActions(actionDefaults, {
  version: 1, toolbar: ["delete", "delete", "retired"], more: ["delete", "arrange"],
  showLabels: { arrange: "broken", delete: true },
});
assert.deepEqual(repaired.toolbar, ["delete"]);
assert.deepEqual(repaired.more, ["arrange", "future-video-export"]);
assert.equal(repaired.showLabels.arrange, true);
assert.equal(repaired.showLabels.delete, true);
assert.deepEqual(normalizeQuickActions(actionDefaults, { version: 99, toolbar: ["delete"] }),
  normalizeQuickActions(actionDefaults));
console.log("Shared quick action migration and future registration tests passed");

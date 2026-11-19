import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyEditorHistory, recordEditorHistory, redoEditorHistory, undoEditorHistory } from "./editor-history.ts";

test("one history orders shot corrections and clip edits and clears redo after a new edit", () => {
  const cuts = { kind: "cuts" as const, before: [10], after: [12] };
  const clips = { kind: "clips" as const, before: [{ id: "a", sourceAssetId: "source", inFrame: 0, outFrame: 20 }],
    after: [{ id: "a", sourceAssetId: "source", inFrame: 0, outFrame: 10 }] };
  const first = recordEditorHistory(emptyEditorHistory(), cuts);
  const second = recordEditorHistory(first, clips);
  assert.equal(second.entries[second.index - 1], clips);
  const undone = undoEditorHistory(second);
  assert.equal(undone.entries[undone.index - 1], cuts);
  assert.equal(redoEditorHistory(undone).index, 2);
  const branch = recordEditorHistory(undone, { ...clips, after: [] });
  assert.equal(branch.entries.length, 2);
  assert.equal(redoEditorHistory(branch), branch);
});

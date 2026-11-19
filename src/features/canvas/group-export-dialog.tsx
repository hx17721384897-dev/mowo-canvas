"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { GroupExportEntry } from "./group-export";
import styles from "./canvas.module.css";

type SavePicker = (options: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) =>
  Promise<{ createWritable: () => Promise<WritableStream<Uint8Array>> }>;

export function GroupExportDialog({ projectId, initialName, entries, skipped, onClose }: {
  projectId: string; initialName: string; entries: GroupExportEntry[]; skipped: number; onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const exportZip = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const filename = `${name.trim().replace(/\.zip$/i, "").replace(/[\\/<>:"|?*\x00-\x1f]/g, "_").replace(/^[.\s]+|[.\s]+$/g, "") || "未命名"}.zip`;
      const picker = (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
      const file = picker ? await picker({ suggestedName: filename, types: [{ description: "ZIP 压缩包", accept: { "application/zip": [".zip"] } }] }) : undefined;
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/group-export`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, entries }),
      });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error ?? "导出失败");
      }
      if (file && response.body) {
        await response.body.pipeTo(await file.createWritable());
        onClose();
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      onClose();
    } catch (failure) {
      if (failure instanceof Error && failure.name !== "AbortError") setError(failure.message);
    } finally { setBusy(false); }
  };
  return createPortal(<div className={styles.groupExportBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section aria-label="导出组" aria-modal="true" className={styles.groupExportDialog} role="dialog">
      <h2>导出压缩包</h2>
      <label>压缩包名称<input autoFocus disabled={busy} maxLength={100} onChange={(event) => setName(event.target.value)} value={name} /></label>
      <p>将导出 {entries.length} 个素材{skipped ? `，跳过 ${skipped} 个没有文件的节点` : ""}。修改名称只影响本次下载。</p>
      {error && <p role="alert">{error}</p>}
      <footer><button disabled={busy} onClick={onClose} type="button">取消</button><button disabled={busy || !entries.length || !name.trim()} onClick={() => void exportZip()} type="button">{busy ? "正在导出…" : "导出 ZIP"}</button></footer>
    </section>
  </div>, document.body);
}

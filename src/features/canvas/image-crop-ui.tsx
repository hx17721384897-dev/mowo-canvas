/* eslint-disable @next/next/no-img-element -- Crop previews use browser-generated data URLs and local source images. */
"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useId } from "react";
import { createPortal } from "react-dom";
import { cropOutputForItem, equalCellGrid, gridItems, loadCropImage, parseCellRatio, renderCrop, resizeGridToCellRatio, suggestedCropOutput, validCropPlan, type CropGrid, type CropItem, type CropPlan, type CropRatioPreset } from "./image-crop";
import { snapCropGrid, type CropGuides } from "./crop-alignment";
import styles from "./image-crop.module.css";

type Template = { name: string; grids: CropGrid[]; output: CropPlan["output"]; sizing?: CropPlan["sizing"] };
type CropSetupSnapshot = { grids: CropGrid[]; active: number; output: CropPlan["output"]; fixedSize: boolean };
const templateKey = "mowo-crop-templates-v1";
const grid = (width: number, height: number): CropGrid => ({ id: crypto.randomUUID(), x: 0, y: 0, width, height,
  rows: 2, columns: 2, xs: [.5], ys: [.5] });
const lines = (count: number) => Array.from({ length: Math.max(0, count - 1) }, (_, i) => (i + 1) / count);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const cellRatio = (ratio: number) => {
  const round = (value: number) => Number(value.toFixed(2));
  return ratio >= 1 ? `${round(ratio)}∶1` : `1∶${round(1 / ratio)}`;
};
const editableRatio = (ratio: number) => ratio >= 1
  ? `${Number(ratio.toFixed(6))}:1` : `1:${Number((1 / ratio).toFixed(6))}`;
const presetRatios: Record<Exclude<CropRatioPreset, "free">, number> = {
  "1:1": 1, "16:9": 16 / 9, "4:3": 4 / 3, "3:2": 3 / 2, "9:16": 9 / 16,
};
const presetForGrid = (item: CropGrid): CropRatioPreset | "none" => {
  if (item.ratioPreset) return item.ratioPreset;
  if (!item.cellAspectRatio) return "none";
  return (Object.keys(presetRatios) as Exclude<CropRatioPreset, "free">[])
    .find((key) => Math.abs(presetRatios[key] - item.cellAspectRatio!) < .000001) ?? "free";
};

function GridPixelField({ label, value, onCommit }: { label: string; value: number; onCommit: (value: number) => void }) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");
  return <label>{label}（像素）<input type="number" value={focused ? draft : Math.round(value)}
    onFocus={() => { setDraft(String(Math.round(value))); setFocused(true); }}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={() => { if (draft.trim() !== "" && Number.isFinite(Number(draft))) onCommit(Number(draft)); setFocused(false); }}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>;
}

function GridRatioField({ ratio, actual, preset, onCommit, onPresetChange }: { ratio?: number; actual: string;
  preset: CropRatioPreset | "none"; onCommit: (ratio: number) => void;
  onPresetChange: (preset: CropRatioPreset | "none") => void }) {
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const initialDraft = useRef(draft);
  const display = focused || invalid ? draft : ratio ? editableRatio(ratio) : actual;
  const commit = () => {
    setFocused(false);
    if (draft === initialDraft.current) return;
    if (!draft.trim()) { setInvalid(false); onPresetChange("none"); return; }
    const parsed = parseCellRatio(draft);
    if (parsed === null) { setInvalid(true); return; }
    setInvalid(false); onCommit(parsed);
  };
  return <div className={styles.ratioControl}><label>比例预设<select value={preset}
    onChange={(event) => onPresetChange(event.target.value as CropRatioPreset | "none")}>
    <option value="none">无</option><option value="free">自由比例</option>
    {Object.keys(presetRatios).map((key) => <option key={key} value={key}>{key}</option>)}
    </select></label><label>单格宽高比（宽∶高）
    <input aria-invalid={invalid} value={display} onFocus={() => { initialDraft.current = display; setDraft(display); setFocused(true); }}
      onChange={(event) => { setDraft(event.target.value); setInvalid(false); }}
      onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
    </label><small>{invalid ? "请输入如 1:1 或 3:2 的正数比例" : ratio ? "修改宽或高时保持这个比例" : "输入比例后选择自由比例；不锁定时可自由分割"}</small>
  </div>;
}

function CropSetupHelp({ fixedSize, output }: { fixedSize: boolean; output: CropPlan["output"] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <span className={styles.cropHelp} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
    onFocus={() => setOpen(true)} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }} onKeyDown={(event) => {
      if (event.key === "Escape") { event.stopPropagation(); setOpen(false); }
    }}>
    <button className={styles.cropHelpButton} type="button" aria-label="裁切图片使用提示"
      aria-describedby={open ? id : undefined} onClick={() => setOpen(true)}>?</button>
    {open && <span className={styles.cropHelpTooltip} id={id} role="tooltip">
      <strong>输出规则</strong>
      <p>{fixedSize ? `每张输出 ${output.width} × ${output.height} 像素。` : "每张按各自裁切框的实际像素尺寸输出。"} 超出原图的部分补透明边，不拉伸画面。</p>
      <strong>操作提示</strong>
      <p>按住 Ctrl 滚轮缩放；拖动空白处平移；靠近原图或其他网格时自动吸附；按住 Shift 拖动角点保持比例；按 Ctrl+Z 撤销裁切设置。</p>
    </span>}
  </span>;
}

function CropTemplateDialog({ current, grids, output, fixedSize, templates, onSave, onDelete, onClose }:
  { current: CropGrid; grids: CropGrid[]; output: CropPlan["output"]; fixedSize: boolean; templates: Template[];
    onSave: (template: Template) => boolean; onDelete: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [rows, setRows] = useState(current.rows);
  const [columns, setColumns] = useState(current.columns);
  const [cellWidth, setCellWidth] = useState(Math.round(current.width / current.columns));
  const [cellHeight, setCellHeight] = useState(Math.round(current.height / current.rows));
  const [ratioText, setRatioText] = useState(current.cellAspectRatio ? editableRatio(current.cellAspectRatio) : "");
  const [fixed, setFixed] = useState(fixedSize);
  const [saveLayout, setSaveLayout] = useState(false);
  const [error, setError] = useState("");
  const ratio = ratioText.trim() ? parseCellRatio(ratioText) : undefined;
  const effectiveHeight = ratio ? Math.max(1, Math.round(cellWidth / ratio)) : cellHeight;
  const save = (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 60) { setError("模板名称需要在 1–60 个字之间"); return; }
    if (!saveLayout && ratioText.trim() && !ratio) { setError("请输入如 1:1 或 16:9 的比例"); return; }
    if (!saveLayout && (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1
      || rows * columns > 500 || !Number.isInteger(cellWidth) || !Number.isInteger(effectiveHeight)
      || cellWidth < 1 || effectiveHeight < 1 || cellWidth > 8192 || effectiveHeight > 8192
      || cellWidth * columns > 100000 || effectiveHeight * rows > 100000
      || cellWidth * effectiveHeight * rows * columns > 100_000_000)) {
      setError("行列、单格尺寸超出裁切范围，请检查数值"); return;
    }
    const templateGrid = equalCellGrid({ id: crypto.randomUUID(), x: 0, y: 0, width: cellWidth * columns,
      height: effectiveHeight * rows, rows, columns, xs: lines(columns), ys: lines(rows),
      ...(ratio ? { cellAspectRatio: ratio, ratioPreset: "free" as const } : {}) }, cellWidth, effectiveHeight);
    const template: Template = saveLayout
      ? { name: cleanName, grids, output: { ...output, mode: "pad" }, sizing: fixedSize ? "fixed" : "per-item" }
      : { name: cleanName, grids: [templateGrid], output: { width: cellWidth, height: effectiveHeight, mode: "pad" },
          sizing: fixed ? "fixed" : "per-item" };
    if (onSave(template)) onClose();
  };
  return <div className={styles.templateOverlay} role="dialog" aria-modal="true" aria-label="新建裁切模板">
    <form className={styles.templateDialog} onSubmit={save}>
      <header><div><h2>新建裁切模板</h2><p>填写常用的单格规格，保存后可从模板列表选用。</p></div>
        <button type="button" onClick={onClose} aria-label="关闭模板窗口">×</button></header>
      <label className={styles.templateCheck}><input type="checkbox" checked={saveLayout} onChange={(event) => setSaveLayout(event.target.checked)} />保存当前全部网格布局</label>
      <div className={styles.templateFields}><label>模板名称<input value={name} maxLength={60} autoFocus
        onChange={(event) => setName(event.target.value)} placeholder="例如：我的方形表情" /></label>
        {!saveLayout && <><label>行数<input type="number" min="1" max="20" value={rows}
          onChange={(event) => setRows(Number(event.target.value))} /></label>
          <label>列数<input type="number" min="1" max="20" value={columns}
            onChange={(event) => setColumns(Number(event.target.value))} /></label>
          <label>单格宽度（像素）<input type="number" min="1" max="8192" value={cellWidth}
            onChange={(event) => setCellWidth(Number(event.target.value))} /></label>
          <label>单格高度（像素）<input type="number" min="1" max="8192" value={effectiveHeight}
            disabled={Boolean(ratio)} onChange={(event) => setCellHeight(Number(event.target.value))} /></label>
          <label>宽高比（可选）<input value={ratioText} onChange={(event) => setRatioText(event.target.value)} placeholder="例如 1:1" /></label>
          <label className={styles.templateCheck}><input type="checkbox" checked={fixed}
            onChange={(event) => setFixed(event.target.checked)} />应用时固定全部网格的比例和单格尺寸</label></>}
      </div>
      {ratio && !saveLayout && <p>按当前宽度计算，单格将为 {cellWidth} × {effectiveHeight} 像素。</p>}
      {error && <p className={styles.templateError} role="alert">{error}</p>}
      {templates.length > 0 && <div className={styles.savedTemplates}><strong>已有模板</strong>
        {templates.map((item) => <div key={item.name}><span>{item.name}</span><button type="button"
          onClick={() => onDelete(item.name)}>删除</button></div>)}
      </div>}
      <footer><button type="button" onClick={onClose}>取消</button><button className={styles.primary} type="submit">保存模板</button></footer>
    </form>
  </div>;
}

export function CropSetup({ source, onClose, onCreate }: { source: Pick<CropPlan, "sourceAssetId" | "sourceUrl" | "sourceName" | "width" | "height"> & Partial<Pick<CropPlan, "grids" | "output" | "sizing">>; onClose: () => void; onCreate: (plan: CropPlan) => void }) {
  const [grids, setGrids] = useState<CropGrid[]>(() => source.grids?.length ? source.grids : [grid(source.width, source.height)]);
  const [active, setActive] = useState(0);
  const [output, setOutput] = useState<CropPlan["output"]>(() => source.output ?? suggestedCropOutput(grid(source.width, source.height)));
  const [fixedSize, setFixedSize] = useState(source.sizing === "fixed");
  const historyRef = useRef<CropSetupSnapshot[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const dragRecordedRef = useRef(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateSelection, setTemplateSelection] = useState("");
  const [templates, setTemplates] = useState<Template[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem(templateKey) ?? "[]") as Template[]; } catch { return []; }
  });
  const [drag, setDrag] = useState<{ kind: "move" | "size" | "x" | "y"; index: number; x: number; y: number; original: CropGrid } | null>(null);
  const [guides, setGuides] = useState<CropGuides>({});
  const [viewZoom, setViewZoom] = useState(1);
  const [viewportSize, setViewportSize] = useState({ width: 600, height: 420 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const zoomAnchorRef = useRef<{ x: number; y: number; screenX: number; screenY: number } | null>(null);
  const centeredRef = useRef(false);
  const measuredViewportRef = useRef<{ width: number; height: number } | null>(null);
  const previousStageRef = useRef<{ scale: number; paddingX: number; paddingY: number } | null>(null);
  const fit = Math.min(viewportSize.width * .98 / source.width, viewportSize.height * .98 / source.height);
  const scale = fit * viewZoom;
  const imageWidth = source.width * scale, imageHeight = source.height * scale;
  const leftGrid = Math.min(0, ...grids.map((item) => item.x));
  const topGrid = Math.min(0, ...grids.map((item) => item.y));
  const rightGrid = Math.max(source.width, ...grids.map((item) => item.x + item.width));
  const bottomGrid = Math.max(source.height, ...grids.map((item) => item.y + item.height));
  const paddingX = Math.max(imageWidth, viewportSize.width / 2, -leftGrid * scale + 48,
    (rightGrid - source.width) * scale + 48);
  const paddingY = Math.max(imageHeight, viewportSize.height / 2, -topGrid * scale + 48,
    (bottomGrid - source.height) * scale + 48);
  const stageWidth = imageWidth + paddingX * 2, stageHeight = imageHeight + paddingY * 2;
  useEffect(() => { dialogRef.current?.focus(); }, []);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const anchor = zoomAnchorRef.current;
    if (anchor) {
      viewport.scrollLeft = paddingX + anchor.x * scale - anchor.screenX;
      viewport.scrollTop = paddingY + anchor.y * scale - anchor.screenY;
      zoomAnchorRef.current = null;
    } else if (!centeredRef.current) {
      viewport.scrollLeft = paddingX + imageWidth / 2 - viewport.clientWidth / 2;
      viewport.scrollTop = paddingY + imageHeight / 2 - viewport.clientHeight / 2;
      centeredRef.current = true;
    } else if (previousStageRef.current?.scale === scale) {
      viewport.scrollLeft += paddingX - previousStageRef.current.paddingX;
      viewport.scrollTop += paddingY - previousStageRef.current.paddingY;
    }
    previousStageRef.current = { scale, paddingX, paddingY };
  }, [scale, paddingX, paddingY, imageWidth, imageHeight]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => {
      const width = viewport.clientWidth, height = viewport.clientHeight;
      if (measuredViewportRef.current?.width === width && measuredViewportRef.current?.height === height) return;
      measuredViewportRef.current = { width, height };
      centeredRef.current = false;
      setViewportSize({ width, height });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  const zoomAt = useCallback((nextZoom: number, screenX?: number, screenY?: number) => {
    const clampedZoom = clamp(nextZoom, .2, 4);
    if (clampedZoom === viewZoom) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const x = screenX ?? viewport.clientWidth / 2, y = screenY ?? viewport.clientHeight / 2;
    zoomAnchorRef.current = { x: (viewport.scrollLeft + x - paddingX) / scale,
      y: (viewport.scrollTop + y - paddingY) / scale, screenX: x, screenY: y };
    setViewZoom(clampedZoom);
  }, [paddingX, paddingY, scale, viewZoom]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const box = viewport.getBoundingClientRect();
      zoomAt(viewZoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1), event.clientX - box.left, event.clientY - box.top);
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [viewZoom, zoomAt]);
  const resetView = () => {
    const viewport = viewportRef.current;
    zoomAnchorRef.current = null;
    centeredRef.current = false;
    if (viewport && viewZoom === 1) {
      viewport.scrollLeft = paddingX + imageWidth / 2 - viewport.clientWidth / 2;
      viewport.scrollTop = paddingY + imageHeight / 2 - viewport.clientHeight / 2;
      centeredRef.current = true;
    }
    setViewZoom(1);
  };
  const record = () => {
    historyRef.current.push({ grids, active, output, fixedSize });
    if (historyRef.current.length > 100) historyRef.current.shift();
    setUndoCount(historyRef.current.length);
  };
  const undo = () => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    setGrids(previous.grids); setActive(previous.active); setOutput(previous.output); setFixedSize(previous.fixedSize);
    setGuides({}); setDrag(null); setUndoCount(historyRef.current.length);
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (templateDialogOpen || !event.ctrlKey || event.shiftKey || event.altKey || event.key.toLowerCase() !== "z") return;
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('[role="dialog"][aria-label="裁切图片"]')
        || target.closest("input, textarea, select, [contenteditable]")) return;
      event.preventDefault(); event.stopPropagation(); undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
  const edit = (change: Partial<CropGrid>, recordHistory = true) => {
    let next = { ...grids[active], ...change };
    if (recordHistory && JSON.stringify(next) !== JSON.stringify(grids[active])) record();
    if (!fixedSize && ("xs" in change || "ys" in change) && !("rows" in change || "columns" in change)) {
      next = { ...next, cellAspectRatio: undefined, ratioPreset: undefined };
    }
    if (fixedSize) {
      let width = "width" in change ? clamp(Math.round(next.width / next.columns), 1, 8192) : output.width;
      let height = "height" in change ? clamp(Math.round(next.height / next.rows), 1, 8192) : output.height;
      if (next.cellAspectRatio && "width" in change) height = clamp(Math.round(width / next.cellAspectRatio), 1, 8192);
      else if (next.cellAspectRatio && "height" in change) width = clamp(Math.round(height * next.cellAspectRatio), 1, 8192);
      setOutput({ width, height, mode: "pad" });
      setGrids((all) => all.map((g, i) => equalCellGrid({ ...(i === active ? next : g),
        cellAspectRatio: next.cellAspectRatio, ratioPreset: next.ratioPreset }, width, height)));
    } else {
      if (next.cellAspectRatio && "width" in change) next = resizeGridToCellRatio(next, "width", next.width);
      else if (next.cellAspectRatio && "height" in change) next = resizeGridToCellRatio(next, "height", next.height);
      else if (next.cellAspectRatio && ("rows" in change || "columns" in change)) next = resizeGridToCellRatio(next, "width", next.width);
      setGrids((all) => all.map((g, i) => i === active ? next : g));
      if (active === 0 && ("rows" in change || "columns" in change || "width" in change || "height" in change || "xs" in change || "ys" in change)) {
        setOutput(suggestedCropOutput(next));
      }
    }
  };
  const current = grids[active];
  const start = (event: React.PointerEvent, kind: "move" | "size" | "x" | "y", index = 0, original = current) => {
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    previewRef.current?.focus();
    setGuides({});
    dragRecordedRef.current = false;
    setDrag({ kind, index, x: event.clientX, y: event.clientY, original });
  };
  const move = (event: React.PointerEvent) => {
    if (panRef.current && viewportRef.current) {
      const pan = panRef.current;
      viewportRef.current.scrollLeft = pan.left - (event.clientX - pan.x);
      viewportRef.current.scrollTop = pan.top - (event.clientY - pan.y);
      return;
    }
    if (!drag) return;
    const dx = (event.clientX - drag.x) / scale;
    const dy = (event.clientY - drag.y) / scale;
    if (!dragRecordedRef.current && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > .1) {
      record(); dragRecordedRef.current = true;
    }
    const g = drag.original;
    if (drag.kind === "move") {
      const snapped = snapCropGrid({ ...g, x: clamp(g.x + dx, -100000, 100000),
        y: clamp(g.y + dy, -100000, 100000) }, source, grids.filter((item) => item.id !== g.id), "move", 8 / scale);
      edit({ x: snapped.grid.x, y: snapped.grid.y }, false);
      setGuides(snapped.guides);
    }
    if (drag.kind === "size") {
      const width = clamp(g.width + dx, 20, 100000);
      const height = event.shiftKey ? clamp(width * g.height / g.width, 20, 100000) : clamp(g.height + dy, 20, 100000);
      const snapped = snapCropGrid({ ...g, width, height }, source, grids.filter((item) => item.id !== g.id), "resize", 8 / scale);
      edit({ width: Math.max(20, snapped.grid.width), height: event.shiftKey
        ? Math.max(20, snapped.grid.width * g.height / g.width) : Math.max(20, snapped.grid.height) }, false);
      setGuides(event.shiftKey ? { x: snapped.guides.x } : snapped.guides);
    }
    if (drag.kind === "x") {
      const xs = [...g.xs]; xs[drag.index] = clamp(g.xs[drag.index] + dx / g.width, (g.xs[drag.index - 1] ?? 0) + .01, (g.xs[drag.index + 1] ?? 1) - .01); edit({ xs }, false);
    }
    if (drag.kind === "y") {
      const ys = [...g.ys]; ys[drag.index] = clamp(g.ys[drag.index] + dy / g.height, (g.ys[drag.index - 1] ?? 0) + .01, (g.ys[drag.index + 1] ?? 1) - .01); edit({ ys }, false);
    }
  };
  const saveTemplate = (template: Template) => {
    if (templates.some((item) => item.name === template.name)
      && !window.confirm(`已存在「${template.name}」，要替换这个模板吗？`)) return false;
    const next = [...templates.filter((item) => item.name !== template.name), template];
    setTemplates(next); localStorage.setItem(templateKey, JSON.stringify(next));
    return true;
  };
  const deleteTemplate = (name: string) => {
    if (!window.confirm(`删除模板「${name}」吗？`)) return;
    const next = templates.filter((item) => item.name !== name);
    setTemplates(next); localStorage.setItem(templateKey, JSON.stringify(next));
  };
  const count = grids.reduce((sum, g) => sum + g.rows * g.columns, 0);
  const ratios = gridItems([current]).map((item) => item.rect.width / item.rect.height);
  const minRatio = Math.min(...ratios), maxRatio = Math.max(...ratios);
  const ratioLabel = Math.abs(maxRatio - minRatio) < .005
    ? cellRatio(minRatio) : `${cellRatio(minRatio)} 至 ${cellRatio(maxRatio)}（各格不等）`;
  const proposal: CropPlan = { ...source, grids, items: gridItems(grids), ordered: false,
    sizing: fixedSize ? "fixed" : "per-item", output: { ...output, mode: "pad" } };
  const toggleFixedSize = () => {
    if (fixedSize) { record(); setFixedSize(false); return; }
    const first = grids[0];
    const width = clamp(Math.round(first.width / first.columns), 1, 8192);
    const height = clamp(Math.round(first.height / first.rows), 1, 8192);
    const normalized = grids.map((item) => equalCellGrid({ ...item, cellAspectRatio: first.cellAspectRatio,
      ratioPreset: first.ratioPreset }, width, height));
    if (grids.some((item, index) => item.width !== normalized[index].width || item.height !== normalized[index].height
      || item.xs.some((line, i) => Math.abs(line - normalized[index].xs[i]) > .00001)
      || item.ys.some((line, i) => Math.abs(line - normalized[index].ys[i]) > .00001))
      && !window.confirm("启用固定比例会让全部网格共用单格尺寸与比例，并把分割线恢复为等距。继续吗？")) return;
    record();
    setGrids(normalized);
    setOutput({ width, height, mode: "pad" });
    setFixedSize(true);
  };
  const addGrid = () => {
    if (grids.length >= 20) return;
    record();
    const base = fixedSize
      ? equalCellGrid({ ...grid(output.width, output.height), cellAspectRatio: current.cellAspectRatio,
        ratioPreset: current.ratioPreset }, output.width, output.height)
      : grid(Math.min(source.width, 512), Math.min(source.height, 512));
    const next = { ...base, id: crypto.randomUUID(), y: current.y + current.height + 16 };
    setGrids([...grids, next]); setActive(grids.length);
  };
  const removeGrid = () => {
    if (grids.length <= 1) return;
    record();
    const next = grids.filter((_, index) => index !== active);
    setGrids(next);
    setActive(Math.min(active, next.length - 1));
    if (!fixedSize && active === 0) setOutput(suggestedCropOutput(next[0]));
  };
  const setRatio = (ratio: number, preset?: CropRatioPreset) => {
    const normalXs = lines(current.columns), normalYs = lines(current.rows);
    if ((current.xs.some((line, i) => Math.abs(line - normalXs[i]) > .00001)
      || current.ys.some((line, i) => Math.abs(line - normalYs[i]) > .00001))
      && !window.confirm("设定单格比例会将当前网格的分割线恢复为等距。继续吗？")) return;
    record();
    const currentPreset = presetForGrid(current);
    const selectedPreset = preset ?? (currentPreset !== "none" && currentPreset !== "free"
      && Math.abs(presetRatios[currentPreset] - ratio) < .000001 ? currentPreset : "free");
    if (fixedSize) {
      const height = clamp(Math.round(output.width / ratio), 1, 8192);
      setOutput({ width: output.width, height, mode: "pad" });
      setGrids((all) => all.map((item) => equalCellGrid({ ...item, cellAspectRatio: ratio,
        ratioPreset: selectedPreset }, output.width, height)));
    } else {
      const next = equalCellGrid({ ...current, cellAspectRatio: ratio, ratioPreset: selectedPreset }, current.width / current.columns,
        current.width / (current.columns * ratio));
      setGrids((all) => all.map((item, index) => index === active ? next : item));
      if (active === 0) setOutput(suggestedCropOutput(next));
    }
  };
  const selectPreset = (preset: CropRatioPreset | "none") => {
    if (preset !== "none" && preset !== "free") { setRatio(presetRatios[preset], preset); return; }
    record();
    const change = preset === "none" ? { cellAspectRatio: undefined, ratioPreset: undefined }
      : { ratioPreset: "free" as const };
    if (fixedSize) setGrids((all) => all.map((item) => ({ ...item, ...change })));
    else setGrids((all) => all.map((item, index) => index === active ? { ...item, ...change } : item));
  };
  const onGridKeyDown = (event: React.KeyboardEvent) => {
    const delta = event.shiftKey ? 10 : 1;
    const offsets: Record<string, [number, number]> = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] };
    const offset = offsets[event.key]; if (!offset) return;
    event.preventDefault(); edit({ x: clamp(current.x + offset[0], -100000, 100000),
      y: clamp(current.y + offset[1], -100000, 100000) });
  };
  return createPortal(<div className={styles.backdrop}><section className={styles.dialog} ref={dialogRef}
    role="dialog" aria-modal="true" aria-label="裁切图片" tabIndex={-1}>
    <header><div><div className={styles.cropTitle}><h2>裁切图片</h2><CropSetupHelp fixedSize={fixedSize} output={output} /></div><p>{source.sourceName} · {source.width} × {source.height} 像素</p></div><button onClick={onClose}>×</button></header>
    <div className={styles.templateBar}><select aria-label="选择裁切模板" value={templateSelection} onChange={(e) => {
      const template = templates.find((item) => item.name === e.target.value);
      if (!template?.grids.length) return;
      record();
      const fixed = template.sizing === "fixed";
      const loaded = template.grids.map((item) => ({ ...item, id: crypto.randomUUID() }));
      setGrids(fixed ? loaded.map((item) => equalCellGrid(item, template.output.width, template.output.height)) : loaded);
      setOutput({ ...template.output, mode: "pad" }); setFixedSize(fixed); setActive(0); setTemplateSelection("");
    }}><option value="">选择模板</option>{templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}</select>
      <button type="button" onClick={() => setTemplateDialogOpen(true)}>＋ 新建 / 管理模板</button></div>
    <div className={styles.setupColumns}>
      <div><div className={styles.sourceViewport} ref={viewportRef}><div className={styles.sourcePreview} ref={previewRef} onKeyDown={onGridKeyDown}
        onPointerDown={(event) => { if (event.target !== event.currentTarget || !viewportRef.current) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          panRef.current = { x: event.clientX, y: event.clientY, left: viewportRef.current.scrollLeft, top: viewportRef.current.scrollTop };
        }}
        onPointerMove={move} onPointerUp={() => { setDrag(null); panRef.current = null; setGuides({}); }}
        onPointerCancel={() => { setDrag(null); panRef.current = null; setGuides({}); }}
        style={{ width: stageWidth, height: stageHeight }} tabIndex={0}>
        <img alt="裁切来源" src={source.sourceUrl} style={{ left: paddingX, top: paddingY, width: imageWidth, height: imageHeight }} />
        <span className={styles.imageBoundaryLabel} style={{ left: paddingX, top: paddingY }}>原图范围</span>
        {guides.x !== undefined && <span className={styles.verticalGuide} style={{ left: paddingX + guides.x * scale }} />}
        {guides.y !== undefined && <span className={styles.horizontalGuide} style={{ top: paddingY + guides.y * scale }} />}
        {grids.map((g, i) => <div className={`${styles.grid} ${i === active ? styles.activeGrid : ""}`} key={g.id}
          style={{ left: paddingX + g.x * scale, top: paddingY + g.y * scale, width: g.width * scale, height: g.height * scale }}
          onClick={() => setActive(i)} onPointerDown={(e) => { setActive(i); start(e, "move", 0, g); }}>
          {g.xs.map((v, n) => <span className={styles.vertical} key={n} style={{ left: `${v * 100}%`, cursor: fixedSize ? "default" : "ew-resize" }} onPointerDown={(e) => { if (fixedSize) return; e.stopPropagation(); setActive(i); start(e, "x", n, g); }} />)}
          {g.ys.map((v, n) => <span className={styles.horizontal} key={n} style={{ top: `${v * 100}%`, cursor: fixedSize ? "default" : "ns-resize" }} onPointerDown={(e) => { if (fixedSize) return; e.stopPropagation(); setActive(i); start(e, "y", n, g); }} />)}
          {i === active && <span className={styles.corner} onPointerDown={(e) => { e.stopPropagation(); start(e, "size"); }} />}
        </div>)}
      </div></div><div className={styles.setupActions}><button disabled={!undoCount} onClick={undo} title="撤销裁切设置（Ctrl+Z）">撤销</button><button onClick={() => edit({ x: 0, y: 0, width: source.width, height: source.height, xs: lines(current.columns), ys: lines(current.rows) })}>重置当前网格</button><button onClick={() => zoomAt(viewZoom - .25)}>－</button><span>{Math.round(viewZoom * 100)}%</span><button onClick={() => zoomAt(viewZoom + .25)}>＋</button><button onClick={resetView}>居中原图</button></div></div>
      <aside><div className={styles.gridTabs}>{grids.map((g, i) => <button aria-pressed={active === i} key={g.id} onClick={() => setActive(i)}>网格 {i + 1} · {g.rows}×{g.columns}</button>)}</div>
        <div className={styles.gridControls}><button disabled={grids.length >= 20} onClick={addGrid}>＋ 添加网格</button><button disabled={grids.length <= 1} onClick={removeGrid}>删除当前网格</button></div>
        <div className={styles.fields}><label>行数<input type="number" min="1" max="20" value={current.rows} onChange={(e) => { const rows = clamp(Number(e.target.value) || 1, 1, 20); edit({ rows, ys: lines(rows) }); }} /></label><label>列数<input type="number" min="1" max="20" value={current.columns} onChange={(e) => { const columns = clamp(Number(e.target.value) || 1, 1, 20); edit({ columns, xs: lines(columns) }); }} /></label>
          {(["x", "y"] as const).map((key) => <GridPixelField key={`${current.id}-${key}`}
            label={{ x: "水平位置", y: "垂直位置" }[key]}
            value={current[key]} onCommit={(value) => edit({ [key]: clamp(value, -100000, 100000) })} />)}
        </div><label className={styles.fixedToggle}><input type="checkbox" checked={fixedSize} onChange={toggleFixedSize} />固定比例
          <span>{fixedSize ? `全部网格共用比例与 ${output.width} × ${output.height} 像素单格；位置和行列各自独立` : "比例和单格尺寸只影响当前网格"}</span></label>
        <GridRatioField key={`${current.id}-${fixedSize}`} ratio={current.cellAspectRatio} preset={presetForGrid(current)}
          actual={Math.abs(maxRatio - minRatio) < .005 ? ratioLabel : ""}
          onCommit={setRatio} onPresetChange={selectPreset} />
        <div className={styles.fields}>
          {(["width", "height"] as const).map((key) => <GridPixelField key={`${current.id}-${key}-${fixedSize}`}
            label={fixedSize ? key === "width" ? "单格宽度" : "单格高度" : key === "width" ? "网格宽度" : "网格高度"}
            value={fixedSize ? output[key] : current[key]}
            onCommit={(value) => edit({ [key]: fixedSize ? clamp(value, 1, 8192) * (key === "width" ? current.columns : current.rows)
              : clamp(value, 1, 100000) })} />)}
        </div><p>单格宽高比 {ratioLabel} · 当前网格 {current.rows * current.columns} 张 · 全部网格 {count} 张</p>
      </aside>
    </div><footer><button onClick={onClose}>取消</button><button className={styles.primary} disabled={!validCropPlan(proposal)} onClick={() => onCreate(proposal)}>创建裁切预览（{count} 张）</button></footer>
    {templateDialogOpen && <CropTemplateDialog current={current} grids={grids} output={output} fixedSize={fixedSize}
      templates={templates} onSave={saveTemplate} onDelete={deleteTemplate}
      onClose={() => { setTemplateDialogOpen(false); previewRef.current?.focus(); }} />}
  </section></div>, document.body);
}

export function useCropPreviews(plan: CropPlan) {
  const [previews, setPreviews] = useState<string[]>([]);
  const signature = JSON.stringify(plan);
  useEffect(() => {
    let live = true;
    Promise.all((plan.sources ?? [{ url: plan.sourceUrl }]).map((source) => loadCropImage(source.url))).then((images) => {
      const urls = plan.items.map((item, index) => renderCrop(images[plan.sources ? index : 0], item,
        cropOutputForItem(plan, item), true).toDataURL("image/png"));
      if (live) setPreviews(urls);
    }).catch(() => { if (live) setPreviews([]); });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  return previews;
}

export function CropEditor({ plan, index, onClose, onSave }: { plan: CropPlan; index: number; onClose: () => void; onSave: (items: CropItem[]) => void }) {
  const [items, setItems] = useState(() => plan.items.map((item) => ({ ...item })));
  const [current, setCurrent] = useState(index);
  const [playing, setPlaying] = useState(false);
  const [targets, setTargets] = useState<number[]>([]);
  const [showTargets, setShowTargets] = useState(false);
  const previewPlan = { ...plan, items };
  const previews = useCropPreviews(previewPlan);
  const originals = useCropPreviews(plan);
  const item = items[current];
  const currentOutput = cropOutputForItem(plan, item);
  useEffect(() => { if (!playing) return; const timer = setTimeout(() => setCurrent((n) => (n + 1) % items.length), item.durationMs); return () => clearTimeout(timer); }, [playing, current, item.durationMs, items.length]);
  const update = (change: Partial<CropItem>) => setItems((all) => all.map((entry, n) => n === current ? { ...entry, ...change } : entry));
  const initial = plan.items[current];
  const apply = () => {
    const zoomFactor = item.zoom / initial.zoom, dx = item.dx - initial.dx, dy = item.dy - initial.dy;
    onSave(items.map((entry, n) => targets.includes(n) && n !== current ? { ...entry, zoom: clamp(entry.zoom * zoomFactor, .01, 20), dx: entry.dx + dx, dy: entry.dy + dy } : entry));
  };
  const requestClose = () => { if (JSON.stringify(items) === JSON.stringify(plan.items) || window.confirm("本次调整尚未保存，确定放弃吗？")) onClose(); };
  return createPortal(<div className={styles.backdrop}><section className={styles.dialog} role="dialog" aria-modal="true" aria-label="单张裁切编辑"><header><div><h2>调整单张 · 第 {current + 1} / {items.length} 张</h2><p>预览调整；保存后仍未生成图片素材</p></div><button onClick={requestClose}>×</button></header>
    <div className={styles.editorColumns}>
      <div><h3>当前成品</h3>{originals[current] && <img className={styles.editorImage} alt="原调整预览"
        src={originals[current]} style={{ aspectRatio: `${currentOutput.width} / ${currentOutput.height}` }} />}</div>
      <div><h3>调整后 · {currentOutput.width}×{currentOutput.height}</h3>
        <div className={styles.editorDrag} style={{ aspectRatio: `${currentOutput.width} / ${currentOutput.height}` }}
          onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
          onPointerMove={(e) => { if (e.buttons !== 1) return;
            update({ dx: item.dx + e.movementX / e.currentTarget.clientWidth, dy: item.dy + e.movementY / e.currentTarget.clientHeight }); }}>
          {previews[current] && <img alt="调整后" src={previews[current]} />}
        </div>
        <div className={styles.controls}><button onClick={() => setCurrent((n) => (n - 1 + items.length) % items.length)}>上一张</button><button onClick={() => setPlaying(!playing)}>{playing ? "暂停" : "播放"}</button><button onClick={() => setCurrent((n) => (n + 1) % items.length)}>下一张</button></div>
      </div>
      <aside className={styles.fields}><label>缩放 (%)<input type="number" min="10" max="2000" value={Math.round(item.zoom * 100)} onChange={(e) => update({ zoom: clamp(Number(e.target.value) / 100, .1, 20) })} /></label><label>水平偏移 (%)<input type="number" value={Math.round(item.dx * 100)} onChange={(e) => update({ dx: Number(e.target.value) / 100 })} /></label><label>垂直偏移 (%)<input type="number" value={Math.round(item.dy * 100)} onChange={(e) => update({ dy: Number(e.target.value) / 100 })} /></label><button onClick={() => update({ zoom: 1, dx: 0, dy: 0 })}>恢复原样</button></aside>
    </div>
    <footer><span>第 {current + 1} / {items.length} 张 · {item.durationMs}ms</span><button onClick={requestClose}>取消</button><button onClick={() => setShowTargets(!showTargets)}>应用到其他{targets.length ? `（${targets.length}）` : ""}</button>{showTargets && <div className={styles.targetList}><label><input type="checkbox" checked={targets.length === items.length - 1} onChange={(e) => setTargets(e.target.checked ? items.map((_, n) => n).filter((n) => n !== current) : [])} />全选其他图片</label>{items.map((entry, n) => n !== current && <label key={entry.id}><input type="checkbox" checked={targets.includes(n)} onChange={(e) => setTargets(e.target.checked ? [...targets, n] : targets.filter((t) => t !== n))} />第 {n + 1} 张</label>)}</div>}<button className={styles.primary} onClick={apply}>保存调整</button></footer>
  </section></div>, document.body);
}

"use client";

import Link from "next/link";
import { Icon } from "@/app/components/app-icon";
import { LoadingProgress } from "@/components/loading-progress";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { usePanelLayout } from "./use-panel-layout";
import { WorkspaceResizeHandle } from "./workspace-resize-handle";
import type { AssetSummary } from "@/features/assets/types";
import { FrameTimeline } from "./frame-timeline";
import { CuttingStrip } from "./cutting-strip";
import { cuttingDuration, cuttingTimeForSource, locateCuttingTime, moveCuttingClip, removeCuttingClip,
  splitCuttingClip, trimCuttingClip, validCuttingClips, type CuttingClip } from "./cutting-model";
import { emptyEditorHistory, recordEditorHistory, redoEditorHistory, undoEditorHistory,
  type EditorHistory } from "./editor-history";
import { followVideoFrames } from "./follow-video-frames";
import styles from "./video-editor.module.css";

function clock(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00:00.000";
  const ms = Math.max(0, Math.floor(seconds * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

function sourceFrameAt(times: number[], seconds: number): number | null {
  if (!times.length || !Number.isFinite(seconds)) return null;
  let low = 0;
  let high = times.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (times[middle] <= seconds) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

type IndexState = { status: "pending" | "running" | "ready" | "failed" | "missing";
  metadata?: { frameCount: number }; error?: string };
type PreviewState = { status: "pending" | "running" | "ready" | "failed" | "missing"; url?: string; error?: string };
type ShotState = { status: "idle" | "waiting" | "running" | "ready" | "failed" | "interrupted" | "missing";
  progressFrames?: number; frameCount?: number; cuts?: { frame: number; score: number }[];
  device?: "cpu" | "dml"; error?: string; manuallyEdited?: boolean; editRevision?: number };
const EMPTY_TIMES: number[] = [];

export function VideoEditorWorkspace({ asset, projectId, initialClip }: { asset: AssetSummary; projectId: string; initialClip?: AssetSummary }) {
  const router = useRouter();
  const bodyRef = useRef<HTMLDivElement>(null);
  const { panels, resizePanel } = usePanelLayout(projectId, bodyRef);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealControls = () => {
    setControlsVisible(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setControlsVisible(false), 2200);
  };
  useEffect(() => {
    controlsTimer.current = setTimeout(() => setControlsVisible(false), 2200);
    return () => { if (controlsTimer.current) clearTimeout(controlsTimer.current); };
  }, []);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [duration, setDuration] = useState(asset.duration ?? 0);
  const [position, setPosition] = useState(initialClip?.clip?.startSeconds ?? 0);
  const [cutting, setCutting] = useState<{ key: string; clips: CuttingClip[] } | null>(null);
  const [cuttingLoaded, setCuttingLoaded] = useState(false);
  const [cuttingLoadError, setCuttingLoadError] = useState("");
  const [cuttingLoadGeneration, setCuttingLoadGeneration] = useState(0);
  const [cuttingSavedSnapshot, setCuttingSavedSnapshot] = useState<string | null>(null);
  const [cuttingSaveError, setCuttingSaveError] = useState("");
  const [cuttingSaving, setCuttingSaving] = useState(false);
  const [cuttingRevisionValue, setCuttingRevisionValue] = useState(0);
  const [outputBusy, setOutputBusy] = useState(false);
  const [outputMessage, setOutputMessage] = useState("");
  const cuttingRevision = useRef(0);
  const cuttingSavedRef = useRef<string | null>(null);
  const cuttingSavePromise = useRef<Promise<boolean> | null>(null);
  const [selectedCuttingClipId, setSelectedCuttingClipId] = useState<string | null>(null);
  const [activeCuttingClipId, setActiveCuttingClipId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"composition" | "source">("composition");
  const [lastCuttingPosition, setLastCuttingPosition] = useState(0);
  const [compositionEnded, setCompositionEnded] = useState(false);
  const activeCuttingClipRef = useRef<string | null>(null);
  const switchingCuttingClip = useRef(false);
  const endGuardTimer = useRef<number | null>(null);
  const clearEndGuard = useCallback(() => {
    if (endGuardTimer.current !== null) window.clearTimeout(endGuardTimer.current);
    endGuardTimer.current = null;
  }, []);
  const [start, setStart] = useState<number | null>(initialClip?.clip?.startSeconds ?? null);
  const [end, setEnd] = useState<number | null>(initialClip?.clip?.endSeconds ?? null);
  const [startFrame, setStartFrame] = useState<number | null>(initialClip?.clip?.startFrame ?? null);
  const [endFrame, setEndFrame] = useState<number | null>(initialClip?.clip?.endFrame ?? null);
  const [clipName, setClipName] = useState("");
  const [savedClips, setSavedClips] = useState<AssetSummary[]>([]);
  const [savedSignature, setSavedSignature] = useState(initialClip?.clip ? `${initialClip.clip.startFrame}:${initialClip.clip.endFrame}` : "");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [frameError, setFrameError] = useState("");
  const [draftOffer, setDraftOffer] = useState<{ startFrame: number | null; endFrame: number | null;
    startSeconds: number | null; endSeconds: number | null; name: string | null } | null>(null);
  const [savedDraftKey, setSavedDraftKey] = useState("");
  const [leavePrompt, setLeavePrompt] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const draftActionInFlight = useRef(false);
  const intentId = useRef<string | null>(null);
  const [error, setError] = useState(false);
  const [playbackSource, setPlaybackSource] = useState(asset.previewUrl ?? "");
  const [previewState, setPreviewState] = useState<PreviewState>({ status: "pending" });
  const [previewVersion, setPreviewVersion] = useState(0);
  const [loadedSource, setLoadedSource] = useState("");
  const previewErrorRef = useRef(false);
  const attemptedPreviewRef = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [zoom, setZoom] = useState(1);
  const pictureRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = pictureRef.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setZoom((current) => Math.min(4, Math.max(.25, current * (event.deltaY < 0 ? 1.1 : 1 / 1.1))));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panOrigin = useRef<{ pointerId: number; x: number; y: number; startX: number; startY: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [indexState, setIndexState] = useState<IndexState>({ status: "pending" });
  const [shotState, setShotState] = useState<ShotState>({ status: "idle" });
  const [shotBusy, setShotBusy] = useState(false);
  const [cutEditing, setCutEditing] = useState(false);
  const [previewCuts, setPreviewCuts] = useState<number[] | null>(null);
  const [selectedCut, setSelectedCut] = useState<number | null>(null);
  const [history, setHistory] = useState<EditorHistory>(emptyEditorHistory);
  const historyRef = useRef(history);
  const historyBusyRef = useRef(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const correctionBusy = useRef(false);
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [correctionError, setCorrectionError] = useState("");
  const [exactFrame, setExactFrame] = useState<{ ordinal: number; seconds: number; url: string } | null>(null);
  const [locating, setLocating] = useState(false);
  const frameUrl = useRef<string | null>(null);
  const requestGeneration = useRef(0);
  const frameRequest = useRef<AbortController | null>(null);
  const frameCache = useRef(new Map<number, { blob: Blob; seconds: number }>());
  const [sourceTimeCache, setSourceTimeCache] = useState<{ key: string; times: number[] } | null>(null);
  const sourceTimeKey = `${projectId}:${asset.id}`;
  const [targetFrame, setTargetFrame] = useState<number | null>(null);
  const indexReady = indexState.status === "ready";
  const sourceTimes = indexReady && sourceTimeCache?.key === sourceTimeKey ? sourceTimeCache.times : EMPTY_TIMES;
  const cuttingClips = useMemo(() => cutting?.key === sourceTimeKey ? cutting.clips : sourceTimes.length
    ? [{ id: sourceTimeKey, sourceAssetId: asset.id, inFrame: 0, outFrame: sourceTimes.length }] : [],
  [cutting, sourceTimeKey, sourceTimes, asset.id]);
  const cuttingSnapshot = JSON.stringify(cuttingClips);
  const cuttingDirty = cuttingLoaded && cuttingSavedSnapshot !== null && cuttingSnapshot !== cuttingSavedSnapshot;
  const cuttingProjectUrl = `/api/projects/${encodeURIComponent(projectId)}/video-editor/${encodeURIComponent(asset.id)}/cutting-project`;
  useEffect(() => {
    if (!sourceTimes.length) return;
    let live = true;
    void fetch(cuttingProjectUrl, { cache: "no-store" }).then(async (response) => {
      const data = await response.json() as { clips: CuttingClip[] | null; revision: number; error?: string };
      if (!response.ok) throw new Error(data.error ?? "剪辑工程读取失败");
      const clips = data.clips ?? [{ id: sourceTimeKey, sourceAssetId: asset.id, inFrame: 0, outFrame: sourceTimes.length }];
      if (!validCuttingClips(clips, asset.id, sourceTimes.length) || !Number.isSafeInteger(data.revision))
        throw new Error("剪辑工程数据无效");
      if (!live) return;
      cuttingRevision.current = data.revision;
      setCuttingRevisionValue(data.revision);
      setCutting({ key: sourceTimeKey, clips });
      cuttingSavedRef.current = JSON.stringify(clips);
      setCuttingSavedSnapshot(cuttingSavedRef.current);
      setCuttingLoadError(""); setCuttingLoaded(true);
    }).catch((error) => { if (live) setCuttingLoadError(error instanceof Error ? error.message : "剪辑工程读取失败"); });
    return () => { live = false; };
  }, [cuttingProjectUrl, sourceTimeKey, sourceTimes, asset.id, cuttingLoadGeneration]);
  const saveCuttingProject = useCallback(async (clips: CuttingClip[], snapshot: string): Promise<boolean> => {
    if (cuttingSavePromise.current) await cuttingSavePromise.current;
    if (cuttingSavedRef.current === snapshot) return true;
    setCuttingSaving(true);
    const job = (async () => {
      try {
        const response = await fetch(cuttingProjectUrl, { method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ clips, expectedRevision: cuttingRevision.current }) });
        const data = await response.json() as { revision?: number; error?: string };
        if (!response.ok || !Number.isSafeInteger(data.revision)) throw new Error(data.error ?? "剪辑工程保存失败");
        cuttingRevision.current = data.revision!;
        setCuttingRevisionValue(data.revision!);
        cuttingSavedRef.current = snapshot;
        setCuttingSavedSnapshot(snapshot);
        setCuttingSaveError("");
        return true;
      } catch (error) {
        setCuttingSaveError(error instanceof Error ? error.message : "剪辑工程保存失败");
        return false;
      }
    })();
    cuttingSavePromise.current = job;
    try { return await job; }
    finally { if (cuttingSavePromise.current === job) cuttingSavePromise.current = null; setCuttingSaving(false); }
  }, [cuttingProjectUrl]);
  useEffect(() => {
    if (!cuttingDirty || cuttingSavePromise.current || cuttingSaveError || cuttingLoadError) return;
    const timer = window.setTimeout(() => {
      void saveCuttingProject(cuttingClips, cuttingSnapshot);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [cuttingDirty, cuttingSnapshot, cuttingSaveError, cuttingLoadError, cuttingClips, saveCuttingProject]);
  const compositionDuration = sourceTimes.length ? cuttingDuration(cuttingClips, sourceTimes, duration) : duration;
  const mappedCuttingPosition = previewMode === "composition" && cuttingClips.length
    ? cuttingTimeForSource(cuttingClips, sourceTimes, duration, activeCuttingClipId ?? cuttingClips[0].id, position) : null;
  const cuttingPosition = compositionEnded && previewMode === "composition" ? compositionDuration
    : previewMode === "composition" && playing ? lastCuttingPosition : mappedCuttingPosition ?? lastCuttingPosition;
  const selectedCuttingClip = cuttingClips.find((clip) => clip.id === selectedCuttingClipId);
  const advanceComposition = useCallback((seconds: number) => {
    if (previewMode !== "composition" || !sourceTimes.length || !cuttingClips.length) { setPosition(seconds); return; }
    if (switchingCuttingClip.current) return;
    if (loop && start !== null && end !== null && end > start && seconds >= end) {
      clearEndGuard();
      if (videoRef.current) videoRef.current.currentTime = start;
      setPosition(start);
      return;
    }
    const index = Math.max(0, cuttingClips.findIndex((clip) => clip.id === activeCuttingClipRef.current));
    const clip = cuttingClips[index];
    // Media can resume from the next source range before the browser dispatches seeked/ended.
    // Reconcile the active composition clip from the observed source time.
    const clipStart = sourceTimes[clip.inFrame];
    if (seconds < clipStart - .05) {
      const next = cuttingClips[index + 1];
      const nextEnd = next && (next.outFrame === sourceTimes.length ? duration : sourceTimes[next.outFrame]);
      if (next && nextEnd !== undefined && seconds >= sourceTimes[next.inFrame] && seconds < nextEnd) {
        activeCuttingClipRef.current = next.id;
        setActiveCuttingClipId(next.id);
        const mapped = cuttingTimeForSource(cuttingClips, sourceTimes, duration, next.id, seconds);
        if (mapped !== null) setLastCuttingPosition(mapped);
        setPosition(seconds);
        return;
      }
    }
    const endSeconds = clip.outFrame === sourceTimes.length ? duration : sourceTimes[clip.outFrame];
    const lastFrameTime = sourceTimes[clip.outFrame - 1];
    const margin = Math.min(.03, Math.max(.002, (endSeconds - lastFrameTime) * .35));
    const next = cuttingClips[index + 1];
    const finish = () => {
      clearEndGuard();
      const video = videoRef.current;
      if (video) {
        video.pause();
        // Keep the last retained frame visible without moving the source playhead back a frame.
        const stoppedAt = Math.min(video.currentTime, endSeconds - margin);
        if (video.currentTime >= endSeconds) video.currentTime = stoppedAt;
        setPosition(stoppedAt);
      }
      setLastCuttingPosition(compositionDuration);
      setCompositionEnded(true);
    };
    if (!next && seconds >= lastFrameTime && seconds < endSeconds - margin && endGuardTimer.current === null) {
      const video = videoRef.current;
      if (video && !video.paused) endGuardTimer.current = window.setTimeout(() => {
        endGuardTimer.current = null;
        if (videoRef.current === video && !video.paused && activeCuttingClipRef.current === clip.id) finish();
      }, Math.max(0, (endSeconds - margin - video.currentTime) / video.playbackRate * 1000));
    }
    if (seconds < endSeconds - (next ? .002 : margin)) {
      setPosition(seconds);
      const mapped = cuttingTimeForSource(cuttingClips, sourceTimes, duration, clip.id, seconds);
      if (mapped !== null) setLastCuttingPosition(mapped);
      return;
    }
    if (!next) { finish(); return; }
    clearEndGuard();
    setLastCuttingPosition(cuttingDuration(cuttingClips.slice(0, index + 1), sourceTimes, duration));
    activeCuttingClipRef.current = next.id;
    setActiveCuttingClipId(next.id);
    if (next.inFrame === clip.outFrame) { setPosition(seconds); return; }
    switchingCuttingClip.current = true;
    const target = sourceTimes[next.inFrame];
    if (videoRef.current) {
      videoRef.current.currentTime = target;
      if (videoRef.current.paused) void videoRef.current.play().catch(() => { /* The user can resume playback manually. */ });
    }
    setPosition(target);
  }, [previewMode, sourceTimes, cuttingClips, duration, compositionDuration, loop, start, end, clearEndGuard]);
  useEffect(() => clearEndGuard, [clearEndGuard]);
  useEffect(() => {
    const video = videoRef.current;
    if (!playing || !video) return;
    return followVideoFrames(video, advanceComposition);
  }, [playing, playbackSource, previewVersion, advanceComposition]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || previewMode !== "composition") return;
    // A source jump can interrupt frame callbacks; keep the composition clock moving while media plays.
    const timer = window.setInterval(() => {
      if (!video.paused && !video.seeking) advanceComposition(video.currentTime);
    }, 100);
    return () => window.clearInterval(timer);
  }, [previewMode, playbackSource, previewVersion, advanceComposition]);
  useEffect(() => {
    const controller = new AbortController();
    if (indexReady) void fetch(`/api/projects/${encodeURIComponent(projectId)}/video-editor/${encodeURIComponent(asset.id)}/index?timeline=1`, { signal: controller.signal })
      .then(async (response) => { if (!response.ok) return; const data = await response.json() as { times: number[] };
        if (!controller.signal.aborted && Array.isArray(data.times) && data.times.every(Number.isFinite))
          setSourceTimeCache({ key: sourceTimeKey, times: data.times });
      }).catch(() => { /* Browser preview remains available while the map is retried on reopening. */ });
    return () => controller.abort();
  }, [indexReady, asset.id, projectId, sourceTimeKey]);
  useEffect(() => () => { frameRequest.current?.abort(); }, []);
  const lastPreviewAt = useRef(0);
  const selectionValid = start !== null && end !== null && end > start;
  const signature = `${startFrame ?? ""}:${endFrame ?? ""}`;
  const selectionKey = `${signature}:${start ?? ""}:${end ?? ""}:${clipName}`;
  const selectionDirty = selectionValid && savedSignature !== signature && savedDraftKey !== selectionKey;
  const canSave = indexState.status === "ready" && selectionValid && startFrame !== null && endFrame !== null
    && endFrame > startFrame && savedSignature !== signature && !saving;
  const previewStateUrl = `/api/projects/${encodeURIComponent(projectId)}/video-editor/${encodeURIComponent(asset.id)}/preview-state`;
  useEffect(() => {
    // A cached video may have loaded before hydration attached its event handlers.
    const frame = requestAnimationFrame(() => {
      if (videoRef.current && videoRef.current.readyState >= 2) setLoadedSource(`${previewVersion}:${playbackSource}`);
    });
    return () => cancelAnimationFrame(frame);
  }, [previewVersion, playbackSource]);
  useEffect(() => {
    let live = true;
    const update = async (method: "GET" | "POST") => {
      try {
        const response = await fetch(previewStateUrl, { method, cache: "no-store" });
        const state = await response.json() as PreviewState;
        if (live) {
          setPreviewState(state);
          if (state.status === "ready" && state.url && previewErrorRef.current && attemptedPreviewRef.current !== state.url) {
            previewErrorRef.current = false;
            attemptedPreviewRef.current = state.url;
            setPlaybackSource(state.url);
            setPreviewVersion((value) => value + 1);
            setError(false);
          }
        }
      } catch { if (live) setPreviewState({ status: "failed", error: "兼容预览服务暂不可用" }); }
    };
    void update(asset.previewUrl?.endsWith("/preview") ? "POST" : "GET");
    const timer = window.setInterval(() => { if (live) void update("GET"); }, 3000);
    return () => { live = false; window.clearInterval(timer); };
  }, [previewStateUrl, asset.previewUrl]);
  const retryPreview = async () => {
    attemptedPreviewRef.current = null;
    setPreviewState({ status: "running" });
    try { setPreviewState(await (await fetch(previewStateUrl, { method: "POST" })).json() as PreviewState); }
    catch { setPreviewState({ status: "failed", error: "兼容预览服务暂不可用" }); }
  };
  useEffect(() => () => { if (frameUrl.current) URL.revokeObjectURL(frameUrl.current); }, []);
  const clearFrame = () => {
    frameRequest.current?.abort();
    setTargetFrame(null);
    requestGeneration.current++;
    if (frameUrl.current) URL.revokeObjectURL(frameUrl.current);
    frameUrl.current = null;
    setExactFrame(null);
    setLocating(false);
  };
  const showFrameOrdinal = async (ordinal: number) => {
    if (indexState.status !== "ready" || !indexState.metadata) return;
    if (!compositionEnded && mappedCuttingPosition !== null) setLastCuttingPosition(mappedCuttingPosition);
    setPreviewMode("source");
    clearFrame();
    const generation = requestGeneration.current;
    const controller = new AbortController();
    frameRequest.current = controller;
    const video = videoRef.current;
    video?.pause();
    setFrameError("");
    setTargetFrame(ordinal);
    // Show the browser preview immediately; precise source decode refines it later.
    const previewTime = sourceTimes[ordinal];
    if (video && !error && Number.isFinite(previewTime)) { video.currentTime = previewTime; setPosition(previewTime); }
    const present = (blob: Blob, seconds: number) => {
      const url = URL.createObjectURL(blob);
      if (frameUrl.current) URL.revokeObjectURL(frameUrl.current);
      frameUrl.current = url;
      try { if (video && !error) video.currentTime = seconds; } catch { /* Exact image remains valid. */ }
      setPosition(seconds);
      setExactFrame({ ordinal, seconds, url });
    };
    const cached = frameCache.current.get(ordinal);
    if (cached) {
      frameCache.current.delete(ordinal); frameCache.current.set(ordinal, cached);
      present(cached.blob, cached.seconds);
      return;
    }
    setLocating(true);
    try {
      const root = `/api/projects/${encodeURIComponent(projectId)}/video-editor/${encodeURIComponent(asset.id)}`;
      const response = await fetch(`${root}/frames/${ordinal}`, { signal: controller.signal });
      if (!response.ok || response.headers.get("X-Source-Frame") !== String(ordinal)) throw new Error("源帧读取失败");
      const seconds = Number(response.headers.get("X-Source-Time"));
      if (!Number.isFinite(seconds)) throw new Error("源帧时间戳无效");
      const blob = await response.blob();
      if (generation !== requestGeneration.current) return;
      if (blob.size <= 16 * 1024 * 1024) {
        frameCache.current.set(ordinal, { blob, seconds });
        let total = Array.from(frameCache.current.values()).reduce((sum, entry) => sum + entry.blob.size, 0);
        while (total > 16 * 1024 * 1024) {
          const key = frameCache.current.keys().next().value!;
          total -= frameCache.current.get(key)!.blob.size; frameCache.current.delete(key);
        }
      }
      present(blob, seconds);
    } catch { if (generation === requestGeneration.current && !controller.signal.aborted) setFrameError("准确帧读取失败，请重试或重新定位"); }
    finally { if (generation === requestGeneration.current) setLocating(false); }
  };
  const retryIndex = async () => {
    setIndexState({ status: "running" });
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/video-editor/${encodeURIComponent(asset.id)}/index`, { method: "POST" });
      setIndexState(await response.json() as IndexState);
    } catch { setIndexState({ status: "failed", error: "无法连接帧索引服务" }); }
  };

  useEffect(() => {
    let live = true;
    const url = `/api/projects/${encodeURIComponent(projectId)}/video-editor/${encodeURIComponent(asset.id)}/index`;
    const read = async (method: "GET" | "POST") => {
      try {
        const response = await fetch(url, { method, cache: "no-store" });
        const state = await response.json() as IndexState;
        if (live) setIndexState(state);
      } catch { if (live) setIndexState({ status: "failed", error: "无法连接帧索引服务" }); }
    };
    void read("POST");
    const timer = window.setInterval(() => { if (live) void read("GET"); }, 2000);
    return () => { live = false; window.clearInterval(timer); };
  }, [asset.id, projectId]);

  const shotUrl = `/api/projects/${encodeURIComponent(projectId)}/video-editor/${encodeURIComponent(asset.id)}/shots`;
  const effectiveCuts = previewCuts ?? shotState.cuts?.map((cut) => cut.frame) ?? [];
  const publishHistory = (next: EditorHistory) => { historyRef.current = next; setHistory(next); };
  const applyCorrection = async (next: number[], recordUndo: boolean) => {
    if (correctionBusy.current || outputBusy || (recordUndo && historyBusyRef.current) || shotState.status !== "ready") return false;
    const before = shotState.cuts?.map((cut) => cut.frame) ?? [];
    if (before.length === next.length && before.every((cut, index) => cut === next[index])) {
      setPreviewCuts(null); return true;
    }
    correctionBusy.current = true; setCorrectionSaving(true);
    setPreviewCuts(next);
    setCorrectionError("");
    try {
      const response = await fetch(shotUrl, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuts: next, expectedRevision: shotState.editRevision ?? 0 }) });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "校正保存失败");
      const state = await response.json() as ShotState;
      setShotState(state);
      if (recordUndo) publishHistory(recordEditorHistory(historyRef.current, { kind: "cuts", before, after: next }));
      return true;
    } catch (error) {
      setCorrectionError(error instanceof Error ? error.message : "校正保存失败");
      try { setShotState(await (await fetch(shotUrl, { cache: "no-store" })).json() as ShotState); }
      catch { /* Keep the visible error; another poll will refresh the state. */ }
      return false;
    } finally { correctionBusy.current = false; setCorrectionSaving(false); setPreviewCuts(null); }
  };
  const travelHistory = async (direction: "undo" | "redo") => {
    if (historyBusyRef.current || correctionBusy.current || outputBusy || !cuttingLoaded) return;
    const current = historyRef.current;
    const entry = direction === "undo" ? current.entries[current.index - 1] : current.entries[current.index];
    if (!entry) return;
    historyBusyRef.current = true; setHistoryBusy(true);
    try {
      const before = direction === "undo" ? entry.after : entry.before;
      const target = direction === "undo" ? entry.before : entry.after;
      if (entry.kind === "cuts") {
        const actual = shotState.cuts?.map((cut) => cut.frame) ?? [];
        if (JSON.stringify(actual) !== JSON.stringify(before)) {
          setCorrectionError("分镜切点已变化，请刷新页面后重试"); return;
        }
        if (!await applyCorrection(target as number[], false)) return;
      } else {
        if (JSON.stringify(cuttingClips) !== JSON.stringify(before)) {
          setCuttingSaveError("剪辑片段已变化，请刷新页面后重试"); return;
        }
        commitCutting(target as CuttingClip[], false);
      }
      publishHistory(direction === "undo" ? undoEditorHistory(current) : redoEditorHistory(current));
    } finally { historyBusyRef.current = false; setHistoryBusy(false); }
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !["z", "y"].includes(event.key.toLowerCase())) return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true']")) return;
      const redo = event.key.toLowerCase() === "y" || event.shiftKey;
      event.preventDefault(); void travelHistory(redo ? "redo" : "undo");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
  useEffect(() => {
    let live = true;
    const read = async () => {
      try {
        const response = await fetch(shotUrl, { cache: "no-store" });
        const state = await response.json() as ShotState;
        if (live) setShotState(state);
      } catch { if (live) setShotState({ status: "failed", error: "分镜状态读取失败" }); }
    };
    void read();
    const timer = window.setInterval(() => { if (live) void read(); }, 2000);
    return () => { live = false; window.clearInterval(timer); };
  }, [shotUrl]);

  const startShot = async () => {
    if (shotBusy) return;
    setShotBusy(true);
    try {
      const response = await fetch(shotUrl, { method: "POST" });
      const state = await response.json() as ShotState;
      setShotState(state);
    } catch { setShotState({ status: "failed", error: "无法启动分镜，请重试" }); }
    finally { setShotBusy(false); }
  };
  const cancelShot = async () => {
    setShotBusy(true);
    try { await fetch(shotUrl, { method: "DELETE" }); }
    finally { setShotBusy(false); }
  };
  const selectShot = async (first: number, last: number) => {
    if (indexState.status !== "ready") return;
    try {
      const base = `/api/projects/${encodeURIComponent(projectId)}/video-editor/${encodeURIComponent(asset.id)}/index`;
      const [startResponse, endResponse] = await Promise.all([
        fetch(`${base}?frame=${first}`), fetch(`${base}?frame=${last}`)]);
      if (!startResponse.ok || !endResponse.ok) throw new Error();
      const [{ frame: from }, { frame: to }] = await Promise.all([
        startResponse.json() as Promise<{ frame: { seconds: number } }>,
        endResponse.json() as Promise<{ frame: { seconds: number } }>]);
      setStartFrame(first); setEndFrame(last); setStart(from.seconds); setEnd(to.seconds);
      setSavedSignature(""); setClipName(""); intentId.current = crypto.randomUUID();
      await showFrameOrdinal(first);
    } catch { setSaveMessage("无法定位该镜头，请重试"); }
  };
  const currentSourceFrame = exactFrame?.ordinal ?? targetFrame ?? sourceFrameAt(sourceTimes, position);
  const shotStarts = [0, ...effectiveCuts];
  const currentShotStart = currentSourceFrame === null ? -1 : shotStarts.findLastIndex((first) => first <= currentSourceFrame);
  const currentShotEnd = shotStarts[currentShotStart + 1] ?? (shotState.status === "ready" ? shotState.frameCount ?? indexState.metadata?.frameCount : undefined);
  const currentShot = currentShotStart >= 0 && currentShotEnd !== undefined && (effectiveCuts.length || shotState.status === "ready")
    ? { start: shotStarts[currentShotStart], end: currentShotEnd } : null;

  const draftUrl = `/api/projects/${encodeURIComponent(projectId)}/video-editor/${encodeURIComponent(asset.id)}/draft`;
  useEffect(() => {
    void fetch(draftUrl).then((response) => response.json())
      .then((data: { draft?: typeof draftOffer }) => setDraftOffer(data.draft ?? null))
      .catch(() => setSaveMessage("草稿读取失败，请稍后重试"));
  }, [draftUrl]);

  useEffect(() => {
    void fetch(`/api/projects/${encodeURIComponent(projectId)}/video-editor/${encodeURIComponent(asset.id)}/clips`)
      .then((response) => response.json()).then((data: { clips?: AssetSummary[] }) => setSavedClips(data.clips ?? []))
      .catch(() => setSaveMessage("片段列表读取失败，请刷新页面"));
  }, [asset.id, projectId]);

  const setBoundary = async (edge: "start" | "end") => {
    setSaveMessage("");
    intentId.current = crypto.randomUUID();
    if (indexState.status !== "ready" || !indexState.metadata) {
      if (edge === "start") { setStart(position); setStartFrame(null); }
      else { setEnd(position); setEndFrame(null); }
      return;
    }
    try {
      const root = `/api/projects/${encodeURIComponent(projectId)}/video-editor/${encodeURIComponent(asset.id)}/index`;
      const chosen = exactFrame?.ordinal ?? (await (await fetch(`${root}?at=${position}`)).json() as { frame: { ordinal: number } }).frame.ordinal;
      const boundary = edge === "end" ? Math.min(indexState.metadata.frameCount, chosen + 1) : chosen;
      const response = await fetch(`${root}?frame=${boundary}`);
      if (!response.ok) throw new Error();
      const time = (await response.json() as { frame: { seconds: number } }).frame.seconds;
      if (edge === "start") { setStart(time); setStartFrame(boundary); }
      else { setEnd(time); setEndFrame(boundary); }
    } catch { setSaveMessage("无法吸附到源帧，请重试"); }
  };

  const saveClip = async (place: boolean) => {
    if (!canSave || startFrame === null || endFrame === null) return;
    setSaving(true); setSaveMessage("");
    intentId.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/video-editor/${encodeURIComponent(asset.id)}/clips`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ intentId: intentId.current, startFrame, endFrame, name: clipName.trim() || undefined }),
      });
      const result = await response.json() as { clip?: AssetSummary; error?: string };
      if (!response.ok || !result.clip) throw new Error(result.error ?? "片段保存失败");
      setSavedClips((items) => [result.clip!, ...items.filter((item) => item.id !== result.clip!.id)]);
      setSavedSignature(signature);
      setSavedDraftKey(""); setDraftOffer(null);
      intentId.current = null;
      setSaveMessage(`已保存片段：${result.clip.name}`);
      if (place) {
        if (cuttingDirty && !await saveCuttingProject(cuttingClips, cuttingSnapshot)) {
          setSaveMessage(`已保存片段：${result.clip.name}。剪辑工程保存失败，请在本页重试后返回画布。`);
          return;
        }
        try { sessionStorage.setItem(`mowo:place-video-clip:${projectId}`, JSON.stringify(result.clip)); }
        catch { setSaveMessage(`已保存片段：${result.clip.name}。自动放入画布失败，可从素材库拖入。`); return; }
        router.push(`/canvas/${encodeURIComponent(projectId)}`);
      }
    } catch (failure) { setSaveMessage(failure instanceof Error ? failure.message : "片段保存失败"); }
    finally { setSaving(false); }
  };

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!selectionDirty && !cuttingDirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [selectionDirty, cuttingDirty]);

  const seek = (value: number) => {
    clearEndGuard();
    clearFrame();
    const video = videoRef.current;
    if (!video || !Number.isFinite(duration)) return;
    const target = Math.max(0, Math.min(duration, value));
    video.currentTime = target;
    setPosition(target);
  };
  const seekCutting = (value: number) => {
    setPreviewMode("composition");
    setCompositionEnded(false);
    const location = locateCuttingTime(cuttingClips, sourceTimes, duration, value);
    if (location) {
      setActiveCuttingClipId(location.clipId);
      activeCuttingClipRef.current = location.clipId;
      setLastCuttingPosition(location.cuttingSeconds);
      seek(location.sourceSeconds);
    } else if (!sourceTimes.length) { setLastCuttingPosition(value); seek(value); }
  };
  const commitCutting = (next: CuttingClip[], recordHistory = true) => {
    if (!cuttingLoaded || outputBusy || correctionBusy.current || (recordHistory && historyBusyRef.current) ||
      JSON.stringify(next) === JSON.stringify(cuttingClips)) return;
    if (recordHistory) publishHistory(recordEditorHistory(historyRef.current,
      { kind: "clips", before: cuttingClips, after: next }));
    setCuttingSaveError("");
    setCutting({ key: sourceTimeKey, clips: next });
    setPreviewMode("composition");
    setCompositionEnded(false);
    if (selectedCuttingClipId && !next.some((clip) => clip.id === selectedCuttingClipId)) setSelectedCuttingClipId(null);
    const location = locateCuttingTime(next, sourceTimes, duration, cuttingPosition);
    if (!location) {
      videoRef.current?.pause();
      setActiveCuttingClipId(null); activeCuttingClipRef.current = null;
      setLastCuttingPosition(0);
      return;
    }
    setActiveCuttingClipId(location.clipId); activeCuttingClipRef.current = location.clipId;
    setLastCuttingPosition(location.cuttingSeconds);
    seek(location.sourceSeconds);
  };
  const snapCuttingFrame = (frame: number) => {
    const nearest = effectiveCuts.find((cut) => Math.abs(cut - frame) <= 3);
    return nearest ?? frame;
  };
  const splitFrame = selectedCuttingClipId === (activeCuttingClipId ?? cuttingClips[0]?.id) && currentSourceFrame !== null
    ? currentSourceFrame : null;
  const exportReady = cuttingLoaded && !cuttingDirty && !cuttingSaving && !cuttingSaveError && !cuttingLoadError &&
    !outputBusy && cuttingClips.length > 0;
  const exportUrl = exportReady ? `${cuttingProjectUrl}/export?revision=${cuttingRevisionValue}` : null;
  const saveOutput = async () => {
    if (!exportReady) return;
    setOutputBusy(true); setOutputMessage("");
    try {
      const response = await fetch(`${cuttingProjectUrl}/output`, { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: cuttingRevision.current }) });
      const data = await response.json() as { asset?: AssetSummary; error?: string };
      if (!response.ok || !data.asset) throw new Error(data.error ?? "成片保存失败");
      router.push(`/canvas/${encodeURIComponent(projectId)}`);
    } catch (error) { setOutputMessage(error instanceof Error ? error.message : "成片保存失败，请重试"); }
    finally { setOutputBusy(false); }
  };
  const leave = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (outputBusy) { event.preventDefault(); setOutputMessage("成片正在生成，请等待完成"); return; }
    if (!selectionDirty && !cuttingDirty) return;
    event.preventDefault();
    setLeavePrompt(true);
  };
  const leaveWithDraft = async () => {
    if (draftActionInFlight.current) return;
    draftActionInFlight.current = true; setDraftBusy(true);
    try {
      if (cuttingDirty && !await saveCuttingProject(cuttingClips, cuttingSnapshot)) throw new Error("剪辑工程保存失败，请重试");
      if (selectionDirty) {
        const response = await fetch(draftUrl, { method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ startFrame, endFrame, startSeconds: start, endSeconds: end, name: clipName || null }) });
        if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "草稿保存失败");
        setSavedDraftKey(selectionKey);
      }
      router.push(`/canvas/${encodeURIComponent(projectId)}`);
    } catch (failure) { setSaveMessage(failure instanceof Error ? failure.message : "保存失败"); setLeavePrompt(false); }
    finally { draftActionInFlight.current = false; setDraftBusy(false); }
  };
  const leaveDiscarding = async () => {
    if (draftActionInFlight.current) return;
    draftActionInFlight.current = true; setDraftBusy(true);
    try {
      if (selectionDirty) {
        const response = await fetch(draftUrl, { method: "DELETE" });
        if (!response.ok) throw new Error("无法清除旧草稿");
        setDraftOffer(null);
      }
      router.push(`/canvas/${encodeURIComponent(projectId)}`);
    } catch { setSaveMessage("无法清除草稿，请重试"); setLeavePrompt(false); }
    finally { draftActionInFlight.current = false; setDraftBusy(false); }
  };

  return <main className={styles.workspace} style={{ "--left-panel": `${panels.left}px`, "--right-panel": `${panels.right}px`, "--timeline-height": `${panels.bottom}px` } as CSSProperties}>
    {draftOffer && <div className={styles.draftOffer} role="dialog" aria-label="恢复视频片段草稿">
      <span>发现上次保存的片段草稿</span>
      <button type="button" onClick={() => {
        setStart(draftOffer.startSeconds); setEnd(draftOffer.endSeconds);
        setStartFrame(draftOffer.startFrame); setEndFrame(draftOffer.endFrame);
        setClipName(draftOffer.name ?? "");
        setSavedDraftKey(`${draftOffer.startFrame ?? ""}:${draftOffer.endFrame ?? ""}:${draftOffer.startSeconds ?? ""}:${draftOffer.endSeconds ?? ""}:${draftOffer.name ?? ""}`);
        if (draftOffer.startSeconds !== null) seek(draftOffer.startSeconds);
        setDraftOffer(null);
      }}>恢复草稿</button>
      <button type="button" onClick={() => setDraftOffer(null)}>稍后再说</button>
    </div>}
    {leavePrompt && <div className={styles.leaveBackdrop} role="presentation"><div className={styles.leaveDialog} role="dialog" aria-modal="true" aria-label="离开视频编辑">
      <h2>{cuttingDirty ? "剪辑工程尚未保存" : "当前选区尚未保存"}</h2>
      <p>{cuttingDirty ? "保存工程后，下次打开同一视频可继续剪辑。" : "可以保存为草稿，下次打开同一视频继续。"}</p>
      <button type="button" disabled={draftBusy} onClick={() => void leaveWithDraft()}>{cuttingDirty ? "保存工程并返回画布" : "保存草稿并返回画布"}</button>
      <button type="button" disabled={draftBusy || cuttingSaving} onClick={() => void leaveDiscarding()}>放弃未保存修改并返回画布</button>
      <button type="button" disabled={draftBusy} onClick={() => setLeavePrompt(false)}>继续编辑</button>
    </div></div>}
    <header className={styles.header}>
      <Link href={`/canvas/${projectId}`} onClick={leave}>← 返回画布</Link>
      <strong title={asset.name}>{asset.name}</strong>
      <button className={styles.historyButton} type="button" aria-label="撤销" title="撤销 Ctrl+Z"
        disabled={!history.index || historyBusy || correctionSaving || outputBusy || !cuttingLoaded} onClick={() => void travelHistory("undo")}>撤销</button>
      <button className={styles.historyButton} type="button" aria-label="重做" title="重做 Ctrl+Y / Ctrl+Shift+Z"
        disabled={history.index >= history.entries.length || historyBusy || correctionSaving || outputBusy || !cuttingLoaded}
        onClick={() => void travelHistory("redo")}>重做</button>
      <span className={styles.projectStatus} role="status">{cuttingLoadError ? `工程读取失败：${cuttingLoadError}` : !cuttingLoaded ? "读取剪辑工程…" :
        cuttingSaveError ? `工程保存失败：${cuttingSaveError}` : cuttingSaving ? "工程保存中…" : cuttingDirty ? "工程未保存" : "工程已保存"}</span>
      {(cuttingLoadError || cuttingSaveError) && <button className={styles.historyButton} type="button" onClick={() => {
        if (cuttingLoadError) { setCuttingLoadError(""); setCuttingLoadGeneration((value) => value + 1); }
        else setCuttingSaveError("");
      }}>重试</button>}
      <span className={styles.badge}>观察页 · {indexState.status === "ready" ? `已索引 ${indexState.metadata?.frameCount ?? 0} 帧` :
        indexState.status === "running" ? "正在建立帧索引" : indexState.status === "failed" ? "帧索引失败" : "帧索引待启动"}</span>
    </header>
    <div className={styles.body} ref={bodyRef}>
      <aside className={styles.left}><div className={styles.shotPanel}>
        <h2>自动分镜</h2>
        {(shotState.status === "idle" || shotState.status === "failed" || shotState.status === "interrupted") &&
          <button className={styles.shotStart} type="button" disabled={shotBusy} onClick={() => void startShot()}>
            {shotState.status === "idle" ? "开始分镜" : "重试分镜"}</button>}
        {(shotState.status === "waiting" || shotState.status === "running") && <>
          <p role="status">{shotState.status === "waiting" ? "等待源帧索引完成…" :
            `正在分镜 ${shotState.frameCount ? Math.floor((shotState.progressFrames ?? 0) / shotState.frameCount * 100) : 0}%${shotState.device ? ` · ${shotState.device === "dml" ? "显卡加速" : "CPU 计算"}` : " · 正在选择运行设备"}`}</p>
          <button className={styles.shotCancel} type="button" disabled={shotBusy} onClick={() => void cancelShot()}>取消分镜</button>
        </>}
        {(shotState.status === "failed" || shotState.status === "interrupted") &&
          <p role="alert">{shotState.error ?? "分镜未完成"}</p>}
        {shotState.status === "ready" && <p>已识别 {(shotState.cuts?.length ?? 0) + 1} 个镜头{shotState.device ? ` · ${shotState.device === "dml" ? "显卡加速" : "CPU 计算"}` : ""}</p>}
        {shotState.status === "ready" && <div className={styles.shotEditControls}>
          <button type="button" aria-pressed={cutEditing} onClick={() => { setCutEditing(!cutEditing); setSelectedCut(null); }}>
            {cutEditing ? "结束校正" : "校正分镜"}</button>
          {cutEditing && <>
            <button type="button" disabled={shotBusy || outputBusy || currentSourceFrame === null || currentSourceFrame <= 0 ||
              currentSourceFrame >= (shotState.frameCount ?? 0) || effectiveCuts.includes(currentSourceFrame)}
              onClick={() => { if (currentSourceFrame !== null) void applyCorrection([...effectiveCuts, currentSourceFrame].sort((a, b) => a - b), true); }}>
              在当前帧拆分</button>
            <button type="button" disabled={shotBusy || outputBusy || selectedCut === null || !effectiveCuts.includes(selectedCut)}
              onClick={() => { if (selectedCut !== null) { void applyCorrection(effectiveCuts.filter((cut) => cut !== selectedCut), true); setSelectedCut(null); } }}>
              删除所选切点</button>
            <small>拖动青色切点移动；松开即保存。删除切点会合并相邻镜头。</small>
          </>}
          {correctionError && <p role="alert">{correctionError}</p>}
        </div>}
        {!!effectiveCuts.length && <div className={styles.shotList} aria-label="镜头列表">{
          [0, ...effectiveCuts].map((first, index, starts) => {
            if (shotState.status !== "ready" && index === starts.length - 1) return null;
            const last = starts[index + 1] ?? shotState.frameCount ?? indexState.metadata?.frameCount ?? 0;
            if (last <= first) return null;
            return <button className={styles.shotItem} type="button" key={`${first}:${last}`}
              aria-current={currentShot?.start === first ? "true" : undefined}
              onClick={() => void selectShot(first, last)} disabled={indexState.status !== "ready"}>
              {/* This frame endpoint returns a disposable JPEG; browser lazy loading avoids decoding all shots at once. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.shotThumb} loading="lazy" alt="" src={`/api/projects/${encodeURIComponent(projectId)}/video-editor/${encodeURIComponent(asset.id)}/frames/${first}`} />
              <span>镜头 {String(index + 1).padStart(3, "0")}<small>源帧 {first}–{last - 1}</small></span>
            </button>;
          })}</div>}
      </div><h2>已保存片段</h2>{savedClips.length ? savedClips.map((clip) =>
        <button className={styles.savedClip} key={clip.id} type="button" onClick={() => {
          if (!clip.clip) return;
          setStart(clip.clip.startSeconds); setEnd(clip.clip.endSeconds);
          setStartFrame(clip.clip.startFrame); setEndFrame(clip.clip.endFrame);
          setSavedSignature(`${clip.clip.startFrame}:${clip.clip.endFrame}`);
          setClipName(""); intentId.current = crypto.randomUUID(); seek(clip.clip.startSeconds);
        }}>{clip.name}<small>{clip.clip ? `${clock(clip.clip.startSeconds)}–${clock(clip.clip.endSeconds)}` : ""}</small></button>)
        : <p>尚无已保存片段。选定准确帧边界后可保存。</p>}</aside>
      <WorkspaceResizeHandle label="调整左侧片段列表宽度" value={panels.left} min={140} max={1200}
        onResize={(delta) => resizePanel("left", delta)} onReset={() => resizePanel("left", 220 - panels.left)} />
      <section className={styles.center} aria-label="视频观察区">
        <div className={styles.stage} ref={playerRef} tabIndex={0} aria-label="视频预览工作区"
          onPointerMove={revealControls} onPointerEnter={revealControls} onFocusCapture={revealControls}
          onPointerLeave={() => { if (controlsTimer.current) clearTimeout(controlsTimer.current); controlsTimer.current = setTimeout(() => setControlsVisible(false), 700); }}>
        <div className={styles.pictureViewport} ref={pictureRef}
          onPointerDown={(event) => {
            if (zoom <= 1 || !event.altKey) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            panOrigin.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: pan.x, startY: pan.y };
          }}
          onPointerMove={(event) => {
            const origin = panOrigin.current;
            if (origin?.pointerId === event.pointerId) setPan({ x: origin.startX + event.clientX - origin.x, y: origin.startY + event.clientY - origin.y });
          }}
          onPointerUp={() => { panOrigin.current = null; }} onPointerCancel={() => { panOrigin.current = null; }}>
          <video key={previewVersion} ref={videoRef} src={playbackSource} playsInline preload="metadata" muted={muted}
            onLoadedData={() => setLoadedSource(`${previewVersion}:${playbackSource}`)}
            style={{ display: error ? "none" : undefined, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            onLoadedMetadata={(event) => { setDuration(event.currentTarget.duration); event.currentTarget.playbackRate = playbackRate; if (initialClip?.clip) event.currentTarget.currentTime = initialClip.clip.startSeconds; }}
            onSeeked={() => { switchingCuttingClip.current = false; }}
            onEnded={(event) => {
              if (previewMode === "composition") advanceComposition(event.currentTarget.duration);
            }}
            onTimeUpdate={(event) => {
              // Playback is synchronized by presented-frame callbacks. Keep this
              // event for paused seeking and the final stopped position only.
              if (event.currentTarget.paused) setPosition(event.currentTarget.currentTime);
              else advanceComposition(event.currentTarget.currentTime);
            }} onPlay={() => { clearFrame(); setPlaying(true); }} onPause={() => { clearEndGuard(); setPlaying(false); }} onError={() => {
              previewErrorRef.current = true; setError(true);
              if (previewState.status === "pending") void retryPreview();
            }} />
          {!exactFrame && !error && loadedSource !== `${previewVersion}:${playbackSource}` && <div className={styles.mediaLoading}>
            <LoadingProgress title="正在读取视频" description="正在准备首帧画面，帧索引将在后台建立。" />
          </div>}
          {error && !exactFrame && (previewState.status === "pending" || previewState.status === "running") && <div className={styles.mediaLoading}>
            <LoadingProgress title="正在准备兼容预览" description="原片已保存，预览准备完成后将自动尝试播放。" />
          </div>}
          {exactFrame && /* The URL is a local, disposable decoded frame; Next image optimization cannot process it. */
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.exactFrame} src={exactFrame.url} alt={`源视频第 ${exactFrame.ordinal} 帧`} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} />}
          {error && !exactFrame && previewState.status !== "pending" && previewState.status !== "running" && <div role="alert" className={styles.previewProblem}><p>{
              previewState.status === "failed" ? `兼容预览生成失败：${previewState.error ?? "请重试"}。原片仍可导入片段。` :
              "当前视频无法播放；原片仍保存在素材库，可等待兼容预览或重试。"}</p>
              <button type="button" onClick={() => void retryPreview()}>重试兼容预览</button></div>}
        </div>
        <div className={`${styles.playerControls} ${controlsVisible ? styles.controlsVisible : ""}`} aria-label="视频播放控制">
          <button type="button" aria-label={playing ? "暂停视频" : "播放视频"}
            disabled={error || (sourceTimes.length > 0 && !cuttingClips.length)} onClick={() => {
            const video = videoRef.current;
            if (!video) return;
            if (playing) video.pause();
            else {
              if (previewMode === "composition" && compositionEnded) seekCutting(0);
              else if (previewMode === "source" && (video.ended || video.currentTime >= duration - .001)) seek(0);
              void video.play().catch(() => setFrameError("暂时无法播放，请重试"));
            }
          }}>{playing ? <span aria-hidden="true">Ⅱ</span> : <Icon name="play" />}</button>
          <input aria-label="视频播放进度" type="range" min={0} max={(previewMode === "composition" ? compositionDuration : duration) || 1} step="0.001"
            disabled={error || !(previewMode === "composition" ? compositionDuration : duration)}
            value={Math.min(previewMode === "composition" ? cuttingPosition : position, (previewMode === "composition" ? compositionDuration : duration) || 1)}
            onChange={(event) => previewMode === "composition" ? seekCutting(event.currentTarget.valueAsNumber) : seek(event.currentTarget.valueAsNumber)} />
          <small>{clock(previewMode === "composition" ? cuttingPosition : position)} / {clock(previewMode === "composition" ? compositionDuration : duration)}</small>
          <button type="button" aria-label={muted ? "开启声音" : "静音"} onClick={() => setMuted(!muted)}>{muted ? "开声" : "静音"}</button>
          <select aria-label="播放速度" value={playbackRate} onChange={(event) => { const rate = Number(event.target.value); setPlaybackRate(rate); if (videoRef.current) videoRef.current.playbackRate = rate; }}>
            {[.5, 1, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
          </select>
          <button type="button" aria-label="全屏查看视频" onClick={() => {
            void playerRef.current?.requestFullscreen().catch(() => setFrameError("当前环境暂不支持全屏"));
          }}><Icon name="scale" /></button>
        </div>
        </div>
        <div className={styles.transport}>
          <strong>{previewMode === "source" ? "查看原片" : "成片预览"}</strong>
          <span>{previewMode === "composition" ? `成片 ${clock(cuttingPosition)} / ${clock(compositionDuration)}` : `原片 ${clock(position)} / ${clock(duration)}`}</span>
          <span>{locating ? "预览中 · 正在校准源帧…" : exactFrame ? `源帧 ${exactFrame.ordinal}` : ""}</span>
          {frameError && <span role="alert">{frameError}</span>}
          <label>观察缩放 <input aria-label="观察缩放" type="range" min="0.25" max="4" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
          <span>Ctrl+滚轮缩放 · Alt+拖动平移</span>
          <button type="button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>适应窗口</button>
        </div>
        <WorkspaceResizeHandle label="调整底部时间轴高度" horizontal value={panels.bottom} min={300} max={620}
          onResize={(delta) => resizePanel("bottom", -delta)} onReset={() => resizePanel("bottom", 420 - panels.bottom)} />
        <div className={styles.timeline}>
          {indexState.status === "ready" && indexState.metadata ? <FrameTimeline frameCount={indexState.metadata.frameCount}
            currentFrame={currentSourceFrame ?? (duration > 0 ? Math.max(0, Math.min(indexState.metadata.frameCount - 1,
              Math.round(position / duration * (indexState.metadata.frameCount - 1)))) : null)}
            currentFrameApproximate={currentSourceFrame === null} startFrame={startFrame} endFrame={endFrame}
            activeShot={currentShot}
            selectedSourceRange={selectedCuttingClip ? { start: selectedCuttingClip.inFrame, end: selectedCuttingClip.outFrame } : null}
            shotCuts={effectiveCuts}
            editCuts={cutEditing && shotState.status === "ready"}
            selectedCut={selectedCut}
            onSelectCut={setSelectedCut}
            onPreviewCut={setPreviewCuts}
            onMoveCut={(from, to) => {
              setSelectedCut(to);
              void applyCorrection((shotState.cuts?.map((cut) => cut.frame) ?? []).map((cut) => cut === from ? to : cut).sort((a, b) => a - b), true);
            }}
            onSeek={(ordinal) => void showFrameOrdinal(ordinal)}
            onPreview={(ordinal) => {
              if (mappedCuttingPosition !== null) setLastCuttingPosition(mappedCuttingPosition);
              setPreviewMode("source");
              videoRef.current?.pause();
              if (performance.now() - lastPreviewAt.current < 50 || !indexState.metadata || !duration) return;
              lastPreviewAt.current = performance.now();
              seek(sourceTimes[ordinal] ?? ordinal / Math.max(1, indexState.metadata.frameCount - 1) * duration);
              setTargetFrame(ordinal);
            }} /> : <><div className={styles.timelineHeader}><strong>时间轴</strong><span>粗选模式 · 帧号待索引</span>
              <label>缩放 <input type="range" min="1" max="8" step="0.5" value={scale} onChange={(event) => setScale(Number(event.target.value))} /></label></div>
            <div className={styles.scroll}><div className={styles.ruler} style={{ width: `${scale * 100}%` }}>
              <input aria-label="播放位置" type="range" min="0" max={duration || 1} step="0.05" value={position} onChange={(event) => seek(Number(event.target.value))} />
              <div className={styles.ticks}><span>00:00</span><span>{clock(duration / 2)}</span><span>{clock(duration)}</span></div>
              {selectionValid && <div className={styles.selection} style={{ left: `${(start! / duration) * 100}%`, width: `${((end! - start!) / duration) * 100}%` }} />}
            </div></div></>}
          <CuttingStrip name={asset.name} clips={cuttingClips} sourceTimes={sourceTimes} sourceDuration={duration}
            duration={compositionDuration} position={cuttingPosition}
            frameBaseUrl={`/api/projects/${encodeURIComponent(projectId)}/video-editor/${encodeURIComponent(asset.id)}/frames`}
            selectedId={selectedCuttingClipId} onSelect={setSelectedCuttingClipId} onSeek={seekCutting}
            disabled={!cuttingLoaded || correctionSaving || historyBusy || outputBusy}
            exportUrl={exportUrl} outputBusy={outputBusy} outputMessage={outputMessage} onSaveOutput={() => void saveOutput()}
            canSplit={!!selectedCuttingClip && splitFrame !== null && splitFrame > selectedCuttingClip.inFrame && splitFrame < selectedCuttingClip.outFrame}
            onSplit={() => {
              if (!selectedCuttingClip || splitFrame === null) return;
              const next = splitCuttingClip(cuttingClips, selectedCuttingClip.id, splitFrame, crypto.randomUUID());
              if (next !== cuttingClips) commitCutting(next);
            }}
            onDelete={() => { if (selectedCuttingClip) commitCutting(removeCuttingClip(cuttingClips, selectedCuttingClip.id)); }}
            onReset={() => commitCutting([{ id: crypto.randomUUID(), sourceAssetId: asset.id, inFrame: 0, outFrame: sourceTimes.length }])}
            shotCuts={effectiveCuts} onTrim={(id, edge, frame) => commitCutting(trimCuttingClip(cuttingClips, id, edge, snapCuttingFrame(frame)))}
            onMove={(id, insertion) => commitCutting(moveCuttingClip(cuttingClips, id, insertion))} />
        </div>
      </section>
      <WorkspaceResizeHandle label="调整右侧片段选择宽度" value={panels.right} min={200} max={1200}
        onResize={(delta) => resizePanel("right", -delta)} onReset={() => resizePanel("right", 260 - panels.right)} />
      <aside className={styles.right}><h2>片段选择</h2><p>索引就绪后设置两端，边界会吸附源帧；索引前只能粗选。</p>
        {indexState.status === "failed" && <p role="alert">帧索引失败：{indexState.error ?? "请稍后重试"}。播放和粗选仍可用。<button type="button" onClick={() => void retryIndex()}>重试分析</button></p>}
        <button type="button" onClick={() => void setBoundary("start")}>设为起点 · {start === null ? "未设" : clock(start)}{startFrame !== null ? ` · 帧 ${startFrame}` : ""}</button>
        <button type="button" onClick={() => void setBoundary("end")}>设为终点 · {end === null ? "未设" : clock(end)}{endFrame !== null ? ` · 边界 ${endFrame}` : ""}</button>
        {start !== null && end !== null && !selectionValid && <p role="alert">终点必须晚于起点。</p>}
        <label><input type="checkbox" checked={loop} disabled={!selectionValid} onChange={(event) => setLoop(event.target.checked)} /> 循环预览选区</label>
        <label>片段名称<input value={clipName} onChange={(event) => setClipName(event.target.value)} placeholder="留空则自动编号" maxLength={100} /></label>
        <button type="button" disabled={!canSave} onClick={() => void saveClip(false)}>仅保存到素材库</button>
        <button type="button" disabled={!canSave} onClick={() => void saveClip(true)}>保存并放入画布</button>
        {saveMessage && <p role="status">{saveMessage}</p>}
      </aside>
    </div>
  </main>;
}

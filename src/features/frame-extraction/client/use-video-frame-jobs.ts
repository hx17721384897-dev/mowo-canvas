"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createVideoFrameJobSchema, type CreateVideoFrameJob, type VideoFrameJob } from "../video-frame-jobs";
import { videoFrameErrorText, videoFrameJobActive } from "../video-frame-controls";

export function useVideoFrameJobs(projectId: string, nodeId: string) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/video-frame-jobs`;
  const key = `mowo:video-frame-request:${encodeURIComponent(projectId)}:${encodeURIComponent(nodeId)}`;
  const [jobs, setJobs] = useState<VideoFrameJob[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  const post = useCallback(async (body: CreateVideoFrameJob) => {
    const response = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const result = await response.json() as { job?: VideoFrameJob; code?: string };
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) { localStorage.removeItem(key); setPending(false); }
      throw new Error(videoFrameErrorText(result.code ?? "INTERNAL_ERROR"));
    }
    if (!result.job || result.job.projectId !== projectId || result.job.nodeId !== nodeId) throw new Error("任务返回无效，请恢复上次请求。");
    localStorage.removeItem(key); setPending(false); setError("");
    setJobs((current) => [...current.filter((job) => job.id !== result.job!.id), result.job!]);
    return result.job;
  }, [base, key, nodeId, projectId]);

  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let again = false;
      try {
        const response = await fetch(`${base}?nodeId=${encodeURIComponent(nodeId)}`, { cache: "no-store",
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]) });
        const payload = await response.json() as { jobs?: VideoFrameJob[]; code?: string };
        if (!response.ok || !payload.jobs || payload.jobs.some((job) => job.projectId !== projectId || job.nodeId !== nodeId)) {
          throw new Error(videoFrameErrorText(payload.code ?? "INTERNAL_ERROR"));
        }
        if (abort.signal.aborted) return;
        setJobs(payload.jobs);
        let raw: string | null;
        try { raw = localStorage.getItem(key); } catch { throw new Error("无法读取本地请求记录，请允许本地存储后重新连接。"); }
        if (raw && !lock.current) {
          const saved = createVideoFrameJobSchema.parse(JSON.parse(raw));
          setPending(true);
          const previous = payload.jobs.find((job) => job.requestId === saved.requestId);
          if (previous) { localStorage.removeItem(key); setPending(false); setError(""); }
          else {
            lock.current = true;
            try { await post(saved); again = true; } finally { lock.current = false; }
          }
        }
        if (!abort.signal.aborted) { setLoaded(true); setReadError(""); }
        again ||= payload.jobs.some(videoFrameJobActive);
      } catch (failure) {
        if (abort.signal.aborted) return;
        setLoaded(false); setReadError(failure instanceof Error ? failure.message : "任务读取失败，请重新连接。");
        again = true;
      }
      if (!abort.signal.aborted && again) timer = setTimeout(() => void poll(), 1200);
    };
    void poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [base, key, nodeId, post, projectId, revision]);

  const submit = useCallback(async (mode: "analyze" | "extract", inputs: CreateVideoFrameJob["inputs"]) => {
    if (lock.current || !loaded || jobs.some(videoFrameJobActive)) return;
    lock.current = true; setRequesting(true); setError("");
    try {
      const previous = localStorage.getItem(key);
      const body = previous ? createVideoFrameJobSchema.parse(JSON.parse(previous))
        : createVideoFrameJobSchema.parse({ requestId: crypto.randomUUID(), nodeId, mode, inputs });
      // Store before sending. A lost response or refresh replays the same id, not a new batch.
      localStorage.setItem(key, JSON.stringify(body)); setPending(true);
      await post(body);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "请求未完成，请恢复上次请求。"); }
    finally { lock.current = false; setRequesting(false); refresh(); }
  }, [jobs, key, loaded, nodeId, post, refresh]);

  const action = useCallback(async (job: VideoFrameJob, value: "cancel" | "retry" | "confirm", inputs?: CreateVideoFrameJob["inputs"]) => {
    if (lock.current) return;
    lock.current = true; setRequesting(true); setError("");
    try {
      const response = await fetch(`${base}/${encodeURIComponent(job.id)}`, { method: "PATCH",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: value, ...(inputs ? {inputs} : {}) }), signal: AbortSignal.timeout(20000) });
      const payload = await response.json() as { job?: VideoFrameJob; code?: string };
      if (!response.ok || !payload.job) throw new Error(videoFrameErrorText(payload.code ?? "INTERNAL_ERROR"));
      setJobs((current) => [...current.filter((item) => item.id !== job.id), payload.job!]);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "操作未完成，请重新连接。"); }
    finally { lock.current = false; setRequesting(false); refresh(); }
  }, [base, refresh]);

  return { jobs, loaded, pending, requesting, error: error || readError, submit, action, refresh };
}

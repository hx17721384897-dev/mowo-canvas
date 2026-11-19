"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/app/components/app-icon";
import type { AssetSummary } from "@/features/assets/types";
import styles from "./video.module.css";

function timeLabel(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

// The picture belongs to the canvas drag surface; only the controls consume gestures.
export function CanvasVideoPlayer({ source, title, clip }: { source: string; title: string; clip?: AssetSummary["clip"] }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const observer = new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) video.pause(); });
    observer.observe(video);
    const pause = () => { if (document.hidden) video.pause(); };
    document.addEventListener("visibilitychange", pause);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", pause); video.pause(); };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clip || !video.requestVideoFrameCallback) return;
    let handle = 0;
    const watch: VideoFrameRequestCallback = (_now, metadata) => {
      if (metadata.mediaTime >= clip.endSeconds) {
        video.pause();
        video.currentTime = Math.max(clip.startSeconds, clip.endSeconds - 0.001);
        setCurrent(clip.endSeconds - clip.startSeconds);
      }
      handle = video.requestVideoFrameCallback(watch);
    };
    handle = video.requestVideoFrameCallback(watch);
    return () => video.cancelVideoFrameCallback(handle);
  }, [clip]);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.error) video.load();
    if (!video.paused) video.pause();
    else {
      if (clip && (video.currentTime < clip.startSeconds || video.currentTime >= clip.endSeconds - 0.002
        || current >= duration - 0.001)) { video.currentTime = clip.startSeconds; setCurrent(0); }
      void video.play().catch(() => setError("暂时无法播放，请重试或确认视频编码受浏览器支持"));
    }
  };

  return <div className={styles.media} ref={frameRef}>
    <video ref={videoRef} className={styles.picture} src={source} aria-label={title} draggable={false}
      playsInline preload="metadata" muted={muted}
      onLoadedMetadata={(event) => {
        const seconds = event.currentTarget.duration;
        setDuration(clip ? Math.max(0, clip.endSeconds - clip.startSeconds) : Number.isFinite(seconds) && seconds > 0 ? seconds : 0);
        if (clip) event.currentTarget.currentTime = clip.startSeconds;
      }}
      onTimeUpdate={(event) => {
        const video = event.currentTarget;
        if (clip && video.currentTime >= clip.endSeconds) { video.pause(); video.currentTime = Math.max(clip.startSeconds, clip.endSeconds - 0.001); }
        setCurrent(clip ? Math.max(0, Math.min(clip.endSeconds - clip.startSeconds, video.currentTime - clip.startSeconds)) : video.currentTime);
      }}
      onPlay={() => { setPlaying(true); setError(""); }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onError={() => setError("预览暂不可用，原片仍保存在资产库中；预览就绪后可点击播放重试")} />
    {error && <span className={styles.playbackError} role="alert">{error}</span>}
    <div className={`${styles.controls} nodrag nopan nowheel`} onKeyDown={(event) => event.stopPropagation()}>
      <button type="button" aria-label={playing ? "暂停视频" : "播放视频"} title={playing ? "暂停" : "播放"} onClick={togglePlayback}>
        {playing ? <span aria-hidden="true">Ⅱ</span> : <Icon name="play" />}
      </button>
      <span className={styles.time}>{timeLabel(current)} / {timeLabel(duration)}</span>
      <input aria-label="视频播放进度" type="range" min={0} max={duration || 1} step={0.01}
        disabled={!duration} value={Math.min(current, duration || 1)} onChange={(event) => {
          const video = videoRef.current;
          if (video) {
            video.currentTime = (clip?.startSeconds ?? 0) + event.currentTarget.valueAsNumber;
            setCurrent(event.currentTarget.valueAsNumber);
          }
        }} />
      <button type="button" aria-label={muted ? "开启视频声音" : "静音视频"} title={muted ? "开启声音" : "静音"}
        onClick={() => setMuted((value) => !value)}>{muted ? "静" : "声"}</button>
      <button type="button" aria-label="全屏查看视频" title="全屏" onClick={() => {
        void frameRef.current?.requestFullscreen().catch(() => setError("当前环境暂不支持全屏查看"));
      }}><Icon name="scale" /></button>
    </div>
  </div>;
}

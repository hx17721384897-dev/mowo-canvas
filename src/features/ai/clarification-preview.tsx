"use client";

import { useState } from "react";
import { ClarificationCard, type ClarificationAnswers, type ClarificationStep } from "./clarification-card";
import styles from "./clarification-card.module.css";

// Static display examples. They never become conversation messages or model input.
const steps: readonly ClarificationStep[] = [
  { id: "delivery", questions: [
    { id: "format", title: "你最终希望收到什么形式的交付物？", options: [
      { id: "gif", label: "可播放的 GIF 动图" },
      { id: "sheet", label: "一张静态的 12 帧序列排列图" },
      { id: "both", label: "两者都要：GIF + 序列排列图" },
      { id: "other", label: "其他，请直接输入…", custom: true },
    ] },
    { id: "order", title: "序列帧的时间顺序如何排列？", options: [
      { id: "reading", label: "从左到右、从上到下，按阅读顺序排列" },
      { id: "custom", label: "其他排列方式，请说明…", custom: true },
    ] },
  ] },
  { id: "grid", questions: [
    { id: "layout", title: "你希望 12 帧采用哪种网格布局？", options: [
      { id: "4x3", label: "4 列 × 3 行" }, { id: "3x4", label: "3 列 × 4 行" },
      { id: "horizontal", label: "12 张横向排列" }, { id: "other", label: "其他，请直接输入…", custom: true },
    ] },
  ] },
  { id: "details", questions: [
    { id: "features", title: "还有哪些细节需要关注？", multiple: true, options: [
      { id: "transparent", label: "保留透明背景" }, { id: "loop", label: "首尾自然衔接" },
      { id: "size", label: "所有帧尺寸保持一致" }, { id: "other", label: "其他要求…", custom: true },
    ] },
  ] },
];

export function ClarificationPreview({ onClose }: { onClose: () => void }) {
  const [result, setResult] = useState<ClarificationAnswers | null>(null);
  const [revision, setRevision] = useState(0);
  if (!result) return <ClarificationCard key={revision} steps={steps} preview onDismiss={onClose} onComplete={setResult} />;
  return <section className={styles.summary} aria-label="提问预览结果">
    <h3>样式预览已完成</h3><p>这些是本次预览的选择，不会发送给模型或写入聊天记录。</p>
    <dl>{steps.flatMap((step) => step.questions).map((question) => {
      const answer = result[question.id];
      const labels = question.options.filter((option) => answer?.selected.includes(option.id)).map((option) => option.custom ? answer.text.trim() || "未填写其他说明" : option.label);
      return <div key={question.id}><dt>{question.title}</dt><dd>{labels.length ? labels.join("；") : "已跳过"}</dd></div>;
    })}</dl>
    <div><button type="button" onClick={() => { setRevision((value) => value + 1); setResult(null); }}>重新预览</button><button type="button" onClick={onClose}>关闭预览</button></div>
  </section>;
}

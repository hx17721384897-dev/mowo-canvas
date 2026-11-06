"use client";

import { useId, useRef, useState } from "react";
import styles from "./clarification-card.module.css";

export type ClarificationQuestion = {
  id: string;
  title: string;
  multiple?: boolean;
  options: readonly { id: string; label: string; custom?: boolean }[];
};
export type ClarificationStep = { id: string; questions: readonly ClarificationQuestion[] };
export type ClarificationAnswers = Record<string, { selected: string[]; text: string }>;

function Chevron({ next = false }: { next?: boolean }) {
  return <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d={next ? "m7 5 5 5-5 5" : "m12 5-5 5 5 5"} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

// Presentation and local selection only. The caller owns delivery and persistence.
export function ClarificationCard({ steps, preview = false, onComplete, onDismiss }: {
  steps: readonly ClarificationStep[];
  preview?: boolean;
  onComplete: (answers: ClarificationAnswers) => void;
  onDismiss: () => void;
}) {
  const prefix = useId();
  const [page, setPage] = useState(0);
  const [answers, setAnswers] = useState<ClarificationAnswers>({});
  const body = useRef<HTMLDivElement>(null);
  const step = steps[page];
  if (!step) return null;
  const ready = step.questions.every((question) => {
    const answer = answers[question.id];
    return answer?.selected.length && (!question.options.some((option) => option.custom && answer.selected.includes(option.id)) || answer.text.trim());
  });
  function move(target: number) {
    setPage(target); body.current?.scrollTo({ top: 0 }); body.current?.focus();
  }
  function choose(question: ClarificationQuestion, optionId: string) {
    setAnswers((current) => {
      const prior = current[question.id] ?? { selected: [], text: "" };
      const selected = question.multiple
        ? prior.selected.includes(optionId) ? prior.selected.filter((id) => id !== optionId) : [...prior.selected, optionId]
        : [optionId];
      return { ...current, [question.id]: { ...prior, selected } };
    });
  }
  function advance() {
    if (page === steps.length - 1) onComplete(answers); else move(page + 1);
  }
  return <section className={styles.card} aria-label={preview ? "提问卡片样式预览" : "需求确认问题"}>
    <header className={styles.header}>
      <span className={styles.heading}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 4h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-5l-4 3v-3H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.5" /><path d="M10 9a2 2 0 1 1 3 1.7c-.8.4-1 .7-1 1.8M12 15h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>提问{preview && <small>样式预览</small>}</span>
      <nav className={styles.navigation} aria-label="问题分页">
        <button aria-label="上一页问题" type="button" disabled={page === 0} onClick={() => move(page - 1)}><Chevron /></button>
        <span aria-live="polite">{page + 1} / {steps.length}</span>
        <button aria-label="下一页问题" type="button" disabled={page === steps.length - 1} onClick={() => move(page + 1)}><Chevron next /></button>
        <button className={styles.close} aria-label="关闭提问卡片" type="button" onClick={onDismiss}>×</button>
      </nav>
    </header>
    <div className={styles.body} ref={body} tabIndex={-1}>
      {step.questions.map((question) => {
        const answer = answers[question.id];
        return <fieldset className={styles.question} key={question.id}>
          <legend>{question.title}<span>{question.multiple ? "多选" : "单选"}</span></legend>
          <div className={styles.options}>{question.options.map((option, index) => {
            const selected = answer?.selected.includes(option.id) ?? false;
            const inputId = `${prefix}-${question.id}-${option.id}`;
            return <div className={`${styles.option} ${selected ? styles.selected : ""}`} key={option.id}>
              <label htmlFor={inputId}>
                <input id={inputId} type={question.multiple ? "checkbox" : "radio"} name={`${prefix}-${question.id}`} checked={selected} onChange={() => choose(question, option.id)} />
                <span className={styles.letter} aria-hidden="true">{String.fromCharCode(65 + index)}</span>
                <span className={styles.optionText}>{option.label}</span>
                {selected && <span className={styles.check} aria-hidden="true">✓</span>}
              </label>
              {option.custom && selected && <textarea className={styles.custom} aria-label={`${question.title}：其他说明`} placeholder="请输入你的想法…" rows={2} maxLength={1000} value={answer?.text ?? ""}
                onChange={(event) => { const text = event.target.value; setAnswers((current) => ({ ...current, [question.id]: { selected: current[question.id]?.selected ?? [], text } })); }} />}
            </div>;
          })}</div>
        </fieldset>;
      })}
    </div>
    <footer className={styles.footer}>
      {preview && <small>仅预览，不会发送</small>}
      <div><button type="button" className={styles.skip} onClick={advance}>跳过</button><button type="button" className={styles.next} disabled={!ready} onClick={advance}>{page === steps.length - 1 ? preview ? "完成预览" : "确认" : "下一个"}<Chevron next /></button></div>
    </footer>
  </section>;
}

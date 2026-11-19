import styles from "./loading-progress.module.css";

export type LoadingProgressProps = {
  title: string;
  description?: string;
  /** Omit when the operation cannot report measurable progress. */
  value?: number;
  variant?: "inline" | "screen" | "overlay";
};

/** Presentation only: the caller owns the operation and its lifetime. */
export function LoadingProgress({ title, description, value, variant = "inline" }: LoadingProgressProps) {
  const progress = typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.min(100, Math.max(0, value))) : undefined;
  return <div className={`${styles.container} ${styles[variant]}`}>
    <div className={styles.card}>
      <div className={styles.heading}><span className={styles.indicator} aria-hidden="true" />
        <strong role="status">{title}</strong>
        <span className={styles.value}>{progress === undefined ? "请稍候" : `${progress}%`}</span>
      </div>
      <div className={styles.track} role="progressbar" aria-label={title}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <span className={progress === undefined ? styles.flow : styles.fill}
          style={progress === undefined ? undefined : { width: `${progress}%` }} />
      </div>
      {description && <p className={styles.description}>{description}</p>}
    </div>
  </div>;
}

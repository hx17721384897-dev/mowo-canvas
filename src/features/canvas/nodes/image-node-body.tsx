import { Icon } from "@/app/components/app-icon";
import type { CanvasModuleData } from "../types";
import styles from "../canvas.module.css";

export function ImageNodeBody({ data }: { data: CanvasModuleData }) {
  return (
    <div className={styles.imageBody}>
      <span className={`${styles.thumbnail} ${data.variant === "cool" ? styles.thumbnailCool : ""}`}>
        <Icon name="image" />
      </span>
      <span className={styles.imageMeta}>
        <strong>{data.title ?? "未命名图片"}</strong>
        <span>{data.detail ?? "等待载入素材"}</span>
      </span>
    </div>
  );
}

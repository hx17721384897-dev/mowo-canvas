import { Icon } from "@/app/components/app-icon";
import styles from "../canvas.module.css";

export function CropNodeBody() {
  return (
    <div className={styles.cropBody}>
      <div className={styles.placeholderRow} />
      <div className={styles.placeholderRow} />
      <div className={styles.placeholderRow} />
      <div className={styles.previewPlaceholder}><Icon name="image" /></div>
      <span className={styles.prototypeNote}>按钮结构待确认</span>
    </div>
  );
}

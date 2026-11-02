"use client";

import { useState } from "react";
import { Icon } from "@/app/components/app-icon";
import styles from "./asset-ui.module.css";

export function ImageDownloadModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");

  return (
    <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-modal="true" className={styles.downloadDialog} role="dialog">
        <header className={styles.downloadHeader}>
          <span className={styles.downloadTitleIcon}><Icon name="download" /></span>
          <div><strong>下载图片</strong><span>导入前预览并选择需要保留的素材</span></div>
          <button aria-label="关闭" onClick={onClose} type="button">×</button>
        </header>
        <div className={styles.urlBar}>
          <Icon name="layers" />
          <input onChange={(event) => setUrl(event.target.value)} placeholder="粘贴图片或表情包链接" value={url} />
          <button onClick={() => setMessage("平台下载解析器尚未接入。你可以先在资产页使用“从本地添加”。")} type="button">下载</button>
        </div>
        {message ? <div className={styles.downloadNotice} role="status">{message}</div> : null}
        <div className={styles.downloadBody}>
          <section className={styles.previewPane}>
            <div className={styles.previewStage}><Icon name="image" /><span>下载完成后在这里预览静态图或动图</span></div>
            <div className={styles.previewControls}>
              <button disabled type="button"><Icon name="chevron-left" />上一张</button>
              <span>0 / 0</span>
              <button disabled type="button">Ⅱ</button>
              <button disabled type="button">下一张<Icon name="chevron-right" /></button>
            </div>
            <dl className={styles.previewMeta}><div><dt>文件名</dt><dd>—</dd></div><div><dt>尺寸</dt><dd>—</dd></div><div><dt>大小</dt><dd>—</dd></div></dl>
          </section>
          <section className={styles.downloadSelection}>
            <header><strong>已下载图片</strong><button disabled type="button">选择</button><span>已选择 0 / 0</span></header>
            <div className={styles.thumbnailEmpty}><Icon name="grid" /><span>等待下载结果</span><small>真实 LINE 下载将在后续适配器中接入</small></div>
          </section>
        </div>
        <footer className={styles.dialogFooter}>
          <span />
          <button onClick={onClose} type="button">取消</button>
          <button className={styles.primaryAction} disabled type="button">导入</button>
        </footer>
      </section>
    </div>
  );
}

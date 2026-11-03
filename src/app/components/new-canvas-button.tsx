"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "./app-icon";

export function NewCanvasButton({ className, card = false }: { className: string; card?: boolean }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "未命名画布" }),
      });
      const payload = await response.json() as { project?: { id: string }; error?: string };
      if (!response.ok || !payload.project) throw new Error(payload.error ?? "创建失败");
      router.push(`/canvas/${payload.project.id}`);
    } finally {
      setCreating(false);
    }
  };

  if (card) {
    return (
      <button className={className} disabled={creating} onClick={() => void create()} type="button">
        <span className="newCanvasIcon"><Icon name="plus" /></span>
        <strong>{creating ? "正在创建…" : "新建画布"}</strong>
        <span>创建一个新的空白工作流</span>
      </button>
    );
  }

  return <button className={className} disabled={creating} onClick={() => void create()} type="button"><Icon name="plus" />{creating ? "正在创建…" : "新建画布"}</button>;
}

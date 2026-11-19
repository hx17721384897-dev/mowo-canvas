"use client";

import { createContext, useCallback, useContext, useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LoadingProgress } from "./loading-progress";

type Navigate = (href: string, title?: string) => void;
const NavigationContext = createContext<Navigate | null>(null);

export function NavigationProgressProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("正在打开页面");
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setSlow(true), 10000);
    return () => window.clearTimeout(timer);
  }, [pending]);
  const navigate: Navigate = useCallback((href, label = "正在打开页面") => {
    setTitle(label);
    setSlow(false);
    startTransition(() => router.push(href));
  }, [router]);
  return <NavigationContext.Provider value={navigate}>
    {children}
    {pending && <LoadingProgress title={title} variant="overlay" description={slow
      ? "页面准备时间较长，正在等待工作区响应。"
      : "正在准备工作区，打开后即可查看视频加载状态。"} />}
  </NavigationContext.Provider>;
}

export function useProgressNavigation() {
  const navigate = useContext(NavigationContext);
  if (!navigate) throw new Error("useProgressNavigation requires NavigationProgressProvider");
  return navigate;
}

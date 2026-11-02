import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MOWO Canvas",
  description: "本地优先的模块化无限画布工作台",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

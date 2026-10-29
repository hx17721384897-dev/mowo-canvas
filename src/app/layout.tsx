import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MOWO Canvas",
  description: "Local-first infinite canvas workspace",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

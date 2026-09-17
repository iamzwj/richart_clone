import type { Metadata } from "next";
import "./globals.css";

export const revalidate = 0;

export const metadata: Metadata = {
  title: `${process.env.NEXT_PUBLIC_CLONE_NAME || "张文杰"} · 设计助理`,
  description: "张文杰设计助理：协助梳理需求、评审方案、探索视觉方向。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}

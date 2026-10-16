import type { Metadata } from "next";
import "./globals.css";

export const revalidate = 0;

export const metadata: Metadata = {
  title: `${process.env.NEXT_PUBLIC_CLONE_NAME || "张文杰"}的设计助理`,
  description: "根据你的需求与参考图生成设计图，支持补充信息、提出修改并持续优化方案。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}

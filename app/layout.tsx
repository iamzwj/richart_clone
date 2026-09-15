import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Richart J · Digital Counterpart",
  description: "和 Richart J 的数字分身聊聊。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}


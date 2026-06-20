import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "webgrapgh — realtime dashboard",
  description:
    "Web Worker + uPlot による高頻度時系列ダッシュボード (60fps 維持)",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}

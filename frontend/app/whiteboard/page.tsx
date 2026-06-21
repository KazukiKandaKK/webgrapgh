import Link from "next/link";
import WhiteboardClient from "@/components/WhiteboardClient";

export const metadata = {
  title: "Whiteboard — webgrapgh",
  description: "Yjs CRDT collaborative whiteboard (Canvas + Web Worker)",
};

export default function WhiteboardPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-6 py-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-slate-500">
            webgrapgh
          </div>
          <h1 className="text-lg font-semibold">Collaborative Whiteboard</h1>
        </div>
        <Link
          href="/"
          className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800"
        >
          ← back to dashboard
        </Link>
      </header>
      <main className="flex flex-1 flex-col p-6">
        <WhiteboardClient />
      </main>
    </div>
  );
}

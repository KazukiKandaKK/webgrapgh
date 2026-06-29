/** Convert a hex color string to rgba with the given alpha. */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = Number.parseInt(m[1], 16);
  const g = Number.parseInt(m[2], 16);
  const b = Number.parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Map a log level string to its Tailwind text-color class. */
export function levelClass(level: string): string {
  switch (level) {
    case "ERROR":
      return "text-rose-400";
    case "WARN":
      return "text-amber-300";
    case "DEBUG":
      return "text-slate-500";
    case "INFO":
      return "text-emerald-300";
    default:
      return "text-slate-600";
  }
}

/** Format a unix-ms timestamp as HH:MM:SS.mmm for log display. */
export function formatLogTime(timeMs: number): string {
  return timeMs > 0
    ? new Date(timeMs).toISOString().slice(11, 23)
    : "--:--:--.---";
}

/** Human-readable byte size (binary units: KiB/MiB/GiB). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Human-readable throughput from a bytes-per-second rate. */
export function formatBps(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

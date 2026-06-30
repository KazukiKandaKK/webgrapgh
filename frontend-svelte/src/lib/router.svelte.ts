// Minimal hash-based router (no dependency). Keeps the app a single static
// bundle while giving each screen its own URL (#/metrics, #/logs, …).

export type Route = {
  path: string;
  label: string;
  icon: string;
};

export const ROUTES: Route[] = [
  { path: "/", label: "Overview", icon: "▦" },
  { path: "/metrics", label: "Metrics", icon: "📈" },
  { path: "/containers", label: "Containers", icon: "📦" },
  { path: "/explore", label: "Explore", icon: "🔍" },
  { path: "/logs", label: "Logs", icon: "🗒" },
  { path: "/alerts", label: "Alerts", icon: "🔔" },
  { path: "/snapshots", label: "Snapshots", icon: "📸" },
  { path: "/heatmap", label: "Heatmap", icon: "🌡" },
  { path: "/settings", label: "Settings", icon: "⚙" },
];

function parseHash(): string {
  const h = window.location.hash.replace(/^#/, "");
  return h === "" ? "/" : h;
}

class Router {
  path = $state(parseHash());

  constructor() {
    window.addEventListener("hashchange", () => {
      this.path = parseHash();
    });
  }

  /** First path segment, e.g. "/explore/cpu" → "/explore". */
  get section(): string {
    const seg = this.path.split("/")[1] ?? "";
    return `/${seg}`;
  }
}

export const router = new Router();

export function navigate(path: string) {
  window.location.hash = path;
}

/** Nav highlight: exact match for "/", section match otherwise. */
export function isActive(routePath: string, current: string): boolean {
  if (routePath === "/") return current === "/";
  return current === routePath || current.startsWith(`${routePath}/`);
}

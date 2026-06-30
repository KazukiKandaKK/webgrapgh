// Minimal hash-based router (no dependency). Keeps the app a single static
// bundle while giving each screen its own URL (#/metrics, #/logs, …).

export type Route = {
  path: string;
  label: string;
  icon: string;
};

export const ROUTES: Route[] = [
  { path: "/", label: "Overview", icon: "overview" },
  { path: "/metrics", label: "Metrics", icon: "metrics" },
  { path: "/containers", label: "Containers", icon: "containers" },
  { path: "/explore", label: "Explore", icon: "explore" },
  { path: "/logs", label: "Logs", icon: "logs" },
  { path: "/alerts", label: "Alerts", icon: "alerts" },
  { path: "/snapshots", label: "Snapshots", icon: "snapshots" },
  { path: "/heatmap", label: "Heatmap", icon: "heatmap" },
  { path: "/settings", label: "Settings", icon: "settings" },
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

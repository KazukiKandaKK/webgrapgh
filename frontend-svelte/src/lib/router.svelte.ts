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
  { path: "/logs", label: "Logs", icon: "🗒" },
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
}

export const router = new Router();

export function navigate(path: string) {
  window.location.hash = path;
}

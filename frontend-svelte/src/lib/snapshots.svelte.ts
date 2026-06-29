export type MetricSeries = {
  t: number[];
  v: number[];
};

export type SnapshotSummary = {
  id: number;
  name: string;
  metric_names: string[];
  range_minutes: number;
  created_at: string;
  comment_count: number;
};

export type Snapshot = SnapshotSummary & {
  series_data: Record<string, MetricSeries>;
};

export type Comment = {
  id: number;
  snapshot_id: number;
  author: string;
  body: string;
  created_at: string;
};

export type CommentPage = {
  comments: Comment[];
  total: number;
  has_more: boolean;
};

export type WSCommentEvent = {
  snapshot_id: number;
  comment: Comment;
};

class SnapshotStore {
  snapshots: SnapshotSummary[] = $state([]);
  current: Snapshot | null = $state(null);
  comments: Comment[] = $state([]);
  commentsTotal: number = $state(0);
  commentsHasMore: boolean = $state(false);
  loading: boolean = $state(false);
  error: string | null = $state(null);

  private _ws: WebSocket | null = null;
  private _wsSnapshotId: number | null = null;
  private _commentsOffset: number = 0;

  async loadSnapshots(apiBase: string): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const res = await fetch(`${apiBase}/api/snapshots`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        this.error = (body as { message?: string }).message ?? `Error ${res.status}`;
        return;
      }
      this.snapshots = await res.json();
    } catch {
      this.error = "Network error — please try again";
    } finally {
      this.loading = false;
    }
  }

  async loadSnapshot(apiBase: string, id: number): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const res = await fetch(`${apiBase}/api/snapshots/${id}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        this.error = (body as { message?: string }).message ?? `Error ${res.status}`;
        return;
      }
      this.current = await res.json();
    } catch {
      this.error = "Network error — please try again";
    } finally {
      this.loading = false;
    }
  }

  async createSnapshot(
    apiBase: string,
    name: string,
    metricNames: string[],
    seriesData: Record<string, MetricSeries>,
    rangeMinutes: number,
  ): Promise<Snapshot | null> {
    this.loading = true;
    this.error = null;
    try {
      const res = await fetch(`${apiBase}/api/snapshots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, metric_names: metricNames, series_data: seriesData, range_minutes: rangeMinutes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        this.error = (body as { message?: string }).message ?? `Error ${res.status}`;
        return null;
      }
      const snap: Snapshot = await res.json();
      return snap;
    } catch {
      this.error = "Network error — please try again";
      return null;
    } finally {
      this.loading = false;
    }
  }

  async deleteSnapshot(apiBase: string, id: number): Promise<boolean> {
    try {
      const res = await fetch(`${apiBase}/api/snapshots/${id}`, { method: "DELETE" });
      if (!res.ok) return false;
      this.snapshots = this.snapshots.filter((s) => s.id !== id);
      if (this.current?.id === id) this.current = null;
      return true;
    } catch {
      return false;
    }
  }

  async loadComments(apiBase: string, snapshotId: number, limit = 50, offset = 0): Promise<void> {
    this.error = null;
    try {
      const res = await fetch(
        `${apiBase}/api/snapshots/${snapshotId}/comments?limit=${limit}&offset=${offset}`,
      );
      if (!res.ok) return;
      const page: CommentPage = await res.json();
      this.comments = page.comments;
      this.commentsTotal = page.total;
      this.commentsHasMore = page.has_more;
      this._commentsOffset = page.comments.length;
    } catch {
      /* silent */
    }
  }

  async loadMoreComments(apiBase: string, snapshotId: number): Promise<void> {
    const limit = 50;
    try {
      const res = await fetch(
        `${apiBase}/api/snapshots/${snapshotId}/comments?limit=${limit}&offset=${this._commentsOffset}`,
      );
      if (!res.ok) return;
      const page: CommentPage = await res.json();
      this.comments = [...this.comments, ...page.comments];
      this.commentsTotal = page.total;
      this.commentsHasMore = page.has_more;
      this._commentsOffset += page.comments.length;
    } catch {
      /* silent */
    }
  }

  async submitComment(
    apiBase: string,
    snapshotId: number,
    author: string,
    body: string,
  ): Promise<Comment | null> {
    try {
      const res = await fetch(`${apiBase}/api/snapshots/${snapshotId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author, body }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { message?: string }).message ?? `Error ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      throw e;
    }
  }

  connectWS(apiBase: string, snapshotId: number): void {
    if (this._ws?.readyState === WebSocket.OPEN || this._ws?.readyState === WebSocket.CONNECTING) {
      this.disconnectWS();
    }
    const wsBase = apiBase.replace(/^http/, "ws");
    this._ws = new WebSocket(`${wsBase}/ws/snapshots`);
    this._wsSnapshotId = snapshotId;

    this._ws.onmessage = (event) => {
      try {
        const ev: WSCommentEvent = JSON.parse(event.data as string);
        if (ev.snapshot_id === this._wsSnapshotId) {
          this.comments = [ev.comment, ...this.comments];
          this.commentsTotal += 1;
        }
      } catch {
        /* ignore malformed messages */
      }
    };

    this._ws.onerror = () => {
      // WS errors do not affect REST API availability
    };

    this._ws.onclose = () => {
      this._ws = null;
    };
  }

  disconnectWS(): void {
    if (
      this._ws?.readyState === WebSocket.OPEN ||
      this._ws?.readyState === WebSocket.CONNECTING
    ) {
      this._ws.close();
    }
    this._ws = null;
    this._wsSnapshotId = null;
  }

  reset(): void {
    this.current = null;
    this.comments = [];
    this.commentsTotal = 0;
    this.commentsHasMore = false;
    this._commentsOffset = 0;
    this.error = null;
  }
}

export const snapshotStore = new SnapshotStore();

export function extractSnapshotId(path: string): number | null {
  const parts = path.split("/");
  const raw = parts[2];
  if (!raw) return null;
  const id = parseInt(raw, 10);
  return isNaN(id) || id <= 0 ? null : id;
}

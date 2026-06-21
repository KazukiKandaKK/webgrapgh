// Shared types between the main thread and the whiteboard worker.

export type ShapeKind = "rect" | "text";

/** What goes into Y.Map<id, ShapeRecord>. Replicated as-is across peers. */
export type ShapeRecord = {
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  text: string;     // empty for rect
  fontSize: number; // used by text; rects also carry it (harmless default)
};

// ---------- main → worker ----------

export type WhiteboardInitMsg = {
  type: "init";
  wsUrl: string;
  /** Room name — all clients joining the same room share a Y.Doc. */
  room: string;
};

/** Move a single shape. Throttled inside the worker before hitting the Y.Doc. */
export type WhiteboardMoveMsg = {
  type: "move";
  id: string;
  x: number;
  y: number;
};

/** Commit any pending throttled moves immediately (e.g. on mouseup). */
export type WhiteboardCommitMsg = { type: "commit" };

/** Insert a new shape with full geometry. Not throttled. */
export type WhiteboardCreateMsg = {
  type: "create";
  id: string;
  shape: ShapeRecord;
};

/** Remove a shape by id. */
export type WhiteboardDeleteMsg = {
  type: "delete";
  id: string;
};

/** Update the text content of an existing shape. */
export type WhiteboardSetTextMsg = {
  type: "setText";
  id: string;
  text: string;
};

/** Wipe every shape. Convenience for testing. */
export type WhiteboardClearMsg = { type: "clear" };

export type WhiteboardMainToWorker =
  | WhiteboardInitMsg
  | WhiteboardMoveMsg
  | WhiteboardCommitMsg
  | WhiteboardCreateMsg
  | WhiteboardDeleteMsg
  | WhiteboardSetTextMsg
  | WhiteboardClearMsg;

// ---------- worker → main ----------

export type WhiteboardStatusMsg = {
  type: "status";
  state: "connecting" | "open" | "closed" | "error";
};

/**
 * A snapshot of every shape's geometry + metadata.
 *
 * Geometry goes through a Float64Array (stride = 4 floats per shape; layout:
 *   coords[i*4 + 0] = x
 *   coords[i*4 + 1] = y
 *   coords[i*4 + 2] = w
 *   coords[i*4 + 3] = h
 * ) which is transferred zero-copy.
 *
 * The string/discrete fields ride alongside as parallel arrays — they change
 * far less often than positions so allocation cost is negligible.
 */
export type WhiteboardFrameMsg = {
  type: "frame";
  ids: string[];
  kinds: ShapeKind[];
  colors: string[];
  texts: string[];
  fontSizes: Float64Array;
  coords: Float64Array;
};

export type WhiteboardWorkerToMain = WhiteboardStatusMsg | WhiteboardFrameMsg;

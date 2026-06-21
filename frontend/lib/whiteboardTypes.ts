// Shared types between the main thread and the whiteboard worker.

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

export type WhiteboardMainToWorker =
  | WhiteboardInitMsg
  | WhiteboardMoveMsg
  | WhiteboardCommitMsg;

export type WhiteboardStatusMsg = {
  type: "status";
  state: "connecting" | "open" | "closed" | "error";
};

/**
 * A snapshot of every shape's geometry, packed into a TypedArray for cheap
 * postMessage transfer. Layout (stride = 4 floats per shape):
 *   coords[i*4 + 0] = x
 *   coords[i*4 + 1] = y
 *   coords[i*4 + 2] = width
 *   coords[i*4 + 3] = height
 *
 * `ids[i]` is the shape id for slot i (used for hit-testing and matching
 * an in-flight drag to the right shape).
 *
 * `colors[i]` is the fill color string for slot i.
 */
export type WhiteboardFrameMsg = {
  type: "frame";
  ids: string[];
  colors: string[];
  coords: Float64Array;
};

export type WhiteboardWorkerToMain = WhiteboardStatusMsg | WhiteboardFrameMsg;

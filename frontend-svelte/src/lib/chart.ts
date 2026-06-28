/** Imperative handle exposed by UplotChart via its `onReady` prop. */
export type UplotChartHandle = {
  setData: (t: Float64Array, v: Float64Array) => void;
};

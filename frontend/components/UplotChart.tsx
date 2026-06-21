"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import uPlot, { type AlignedData, type Options } from "uplot";

export type UplotChartHandle = {
  /** Imperative data swap — bypasses React entirely. */
  setData: (t: Float64Array, v: Float64Array) => void;
};

type Props = {
  title: string;
  color: string;
  height?: number;
  /** y-axis range; pass [null, null] for auto. */
  yRange?: [number | null, number | null];
};

/**
 * A thin imperative wrapper around uPlot. The chart owns its Canvas; React is
 * only used to mount/unmount it. Data updates are dispatched through the ref
 * returned via forwardRef, so we never re-render on the hot path.
 */
export const UplotChart = forwardRef<UplotChartHandle, Props>(function UplotChart(
  { title, color, height = 220, yRange = [0, 100] },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const dataRef = useRef<AlignedData>([new Float64Array(), new Float64Array()]);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth || 600;

    const opts: Options = {
      title,
      width,
      height,
      pxAlign: false,
      cursor: { drag: { x: true, y: false } },
      scales: {
        x: { time: true },
        y: {
          // For each bound, `null` falls back to uPlot's auto-fit value.
          range: (_u, dataMin, dataMax) => [
            yRange[0] !== null ? yRange[0] : dataMin,
            yRange[1] !== null ? yRange[1] : dataMax,
          ],
        },
      },
      axes: [
        { stroke: "#94a3b8", grid: { stroke: "#1e293b" } },
        { stroke: "#94a3b8", grid: { stroke: "#1e293b" } },
      ],
      series: [
        {},
        {
          label: title,
          stroke: color,
          width: 1.25,
          fill: hexToRgba(color, 0.12),
          points: { show: false },
        },
      ],
      legend: { show: true, live: true },
    };

    const plot = new uPlot(opts, dataRef.current, container);
    plotRef.current = plot;

    // Resize with the container.
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        if (w > 0) plot.setSize({ width: w, height });
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, [title, color, height, yRange]);

  const firstSetDataRef = useRef(true);
  useImperativeHandle(ref, () => ({
    setData(t, v) {
      const plot = plotRef.current;
      if (!plot) {
        if (firstSetDataRef.current) {
          // eslint-disable-next-line no-console
          console.warn(`[uplot:${title}] setData called before plot ready (n=${t.length})`);
        }
        return;
      }
      if (firstSetDataRef.current) {
        firstSetDataRef.current = false;
        // eslint-disable-next-line no-console
        console.info(`[uplot:${title}] first setData: ${t.length} pts`);
      }
      // uPlot expects `AlignedData = [xs, ys, ys, ...]`. We hand it the
      // Float64Arrays straight from the Worker — no allocation, no copy.
      dataRef.current = [t, v];
      plot.setData(dataRef.current, false);
    },
  }), [title]);

  return <div ref={containerRef} className="w-full" style={{ height }} />;
});

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

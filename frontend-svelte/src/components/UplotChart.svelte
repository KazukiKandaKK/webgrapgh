<script lang="ts">
  import { onMount } from "svelte";
  import uPlot, { type AlignedData, type Options } from "uplot";
  import { hexToRgba } from "@shared/utils";
  import type { UplotChartHandle } from "../lib/chart";

  type Props = {
    title: string;
    color: string;
    height?: number;
    /** [min, max]; null on either side means auto-fit. */
    yRange?: [number | null, number | null];
    /** Receives the imperative API once the canvas is ready. */
    onReady?: (api: UplotChartHandle) => void;
  };

  let {
    title,
    color,
    height = 220,
    yRange = [0, 100],
    onReady,
  }: Props = $props();

  let container: HTMLDivElement;
  let plot: uPlot | null = null;
  const data: AlignedData = [new Float64Array(), new Float64Array()];
  let firstSetData = true;

  onMount(() => {
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
          range: (_u, dataMin, dataMax) => {
            const lo =
              yRange[0] !== null
                ? yRange[0]
                : Number.isFinite(dataMin)
                  ? dataMin
                  : 0;
            const hi =
              yRange[1] !== null
                ? yRange[1]
                : Number.isFinite(dataMax)
                  ? dataMax
                  : lo + 1;
            return [lo, hi];
          },
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

    plot = new uPlot(opts, data, container);

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        if (w > 0 && plot) plot.setSize({ width: w, height });
      }
    });
    ro.observe(container);

    // Hand the imperative API to the parent once the canvas is live.
    onReady?.({
      setData(t, v) {
        if (!plot) return;
        if (firstSetData) {
          firstSetData = false;
          // eslint-disable-next-line no-console
          console.info(
            `[uplot:${title}] first setData: ${t.length} pts ` +
              `(t=${t[0]?.toFixed(0)}…${t[t.length - 1]?.toFixed(0)}, ` +
              `v=${v[0]?.toFixed(2)}…${v[v.length - 1]?.toFixed(2)})`,
          );
        }
        data[0] = t;
        data[1] = v;
        // resetScales=true so the x-axis (Unix seconds) re-fits each frame.
        // y is pinned by the explicit `range` callback above.
        plot.setData(data, true);
      },
    });

    return () => {
      ro.disconnect();
      plot?.destroy();
      plot = null;
    };
  });
</script>

<div bind:this={container} class="w-full" style="height: {height}px"></div>

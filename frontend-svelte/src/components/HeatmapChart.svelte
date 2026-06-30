<script lang="ts">
  import { onMount } from "svelte";
  import uPlot, { type AlignedData, type Options } from "uplot";
  import { METRIC_META } from "@shared/constants";
  import { useWorker } from "../lib/workerController.svelte";
  import { settings, ACCENTS } from "../lib/settings.svelte";
  import {
    bucketize,
    interpolateColor,
    valueBounds,
    HEATMAP_COLS,
    HEATMAP_BUCKETS,
  } from "../lib/heatmap";
  import type { MetricName } from "../lib/types";

  type Props = {
    metricName: MetricName;
    height?: number;
  };

  let { metricName, height = 200 }: Props = $props();

  const controller = useWorker();

  let container: HTMLDivElement;

  onMount(() => {
    // Snapshot props at mount time — metricName and height are static per instance.
    const meta = METRIC_META[metricName];
    // Mutable state read by the draw hook on every repaint.
    let densityGrid: Float64Array | null = null;
    let valMin = meta.yRange[0] ?? 0;
    let valMax = meta.yRange[1] ?? 1;

    // Dummy x and y buffers — drives uPlot's time scale; y anchors the y scale.
    const xBuf = new Float64Array(2);
    const yBuf = new Float64Array(2);
    const data: AlignedData = [xBuf, yBuf];

    function drawHeatmap(u: uPlot) {
      if (!densityGrid) return;

      const { left, top, width, height: bh } = u.bbox;
      const ctx = u.ctx;
      const cellW = width / HEATMAP_COLS;
      const cellH = bh / HEATMAP_BUCKETS;
      const accentHex = ACCENTS[settings.current.accent].color;

      ctx.save();
      for (let col = 0; col < HEATMAP_COLS; col++) {
        for (let bkt = 0; bkt < HEATMAP_BUCKETS; bkt++) {
          const density = densityGrid[col * HEATMAP_BUCKETS + bkt];
          if (density === 0) continue;
          ctx.fillStyle = interpolateColor(accentHex, density);
          // Bucket 0 is the lowest value → draw at the bottom of the plot.
          ctx.fillRect(
            left + col * cellW,
            top + (HEATMAP_BUCKETS - 1 - bkt) * cellH,
            Math.ceil(cellW) + 0.5,
            Math.ceil(cellH) + 0.5,
          );
        }
      }
      ctx.restore();
    }

    const opts: Options = {
      width: container.clientWidth || 600,
      height,
      pxAlign: false,
      cursor: { show: false },
      scales: {
        x: { time: true },
        y: {
          range: () => [valMin, valMax],
        },
      },
      axes: [
        { stroke: "#94a3b8", grid: { stroke: "#1e293b" } },
        {
          stroke: "#94a3b8",
          grid: { stroke: "#1e293b" },
          label: `${meta.label} (${meta.unit})`,
        },
      ],
      series: [
        {},
        {
          // Hidden anchor series — keeps uPlot's y scale in sync.
          show: false,
          label: "",
          stroke: "transparent",
          points: { show: false },
        },
      ],
      legend: { show: false },
      plugins: [{ hooks: { draw: [drawHeatmap] } }],
    };

    const plot = new uPlot(opts, data, container);

    const off = controller.onFrame((metrics) => {
      const series = metrics[metricName];
      if (!series || series.t.length < 2) return;

      const { t, v } = series;
      const tMin = t[0];
      const tMax = t[t.length - 1];
      if (tMax <= tMin) return;

      const [lo, hi] = valueBounds(v, meta.yRange[0], meta.yRange[1]);
      valMin = lo;
      valMax = hi;

      densityGrid = bucketize(t, v, tMin, tMax, HEATMAP_COLS, lo, hi, HEATMAP_BUCKETS);

      xBuf[0] = tMin;
      xBuf[1] = tMax;
      yBuf[0] = lo;
      yBuf[1] = hi;
      plot.setData(data, true);
    });

    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.floor(e.contentRect.width);
        if (w > 0) plot.setSize({ width: w, height });
      }
    });
    ro.observe(container);

    return () => {
      off();
      ro.disconnect();
      plot.destroy();
    };
  });
</script>

<div bind:this={container} class="w-full" style="height: {height}px"></div>

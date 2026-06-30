<script lang="ts">
  import { onMount } from "svelte";
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

  let canvas: HTMLCanvasElement;

  onMount(() => {
    const meta = METRIC_META[metricName];
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d")!;

    let lastGrid: Float64Array | null = null;
    let lastLo = meta.yRange[0] ?? 0;
    let lastHi = meta.yRange[1] ?? 1;

    function resize() {
      const w = canvas.clientWidth;
      const h = height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function render(grid: Float64Array, lo: number, hi: number) {
      const w = canvas.clientWidth;
      const h = height;
      const accentHex = ACCENTS[settings.current.accent].color;

      ctx.clearRect(0, 0, w, h);

      const cellW = w / HEATMAP_COLS;
      const cellH = h / HEATMAP_BUCKETS;

      for (let col = 0; col < HEATMAP_COLS; col++) {
        for (let bkt = 0; bkt < HEATMAP_BUCKETS; bkt++) {
          const density = grid[col * HEATMAP_BUCKETS + bkt];
          if (density === 0) continue;
          ctx.fillStyle = interpolateColor(accentHex, density);
          // bkt 0 = lowest value → bottom of canvas; flip Y axis.
          ctx.fillRect(
            col * cellW,
            (HEATMAP_BUCKETS - 1 - bkt) * cellH,
            Math.ceil(cellW) + 0.5,
            Math.ceil(cellH) + 0.5,
          );
        }
      }

      // Y axis labels (min / max value)
      ctx.fillStyle = "#94a3b8";
      ctx.font = "10px monospace";
      ctx.textAlign = "left";
      ctx.fillText(hi.toFixed(1), 4, 12);
      ctx.fillText(lo.toFixed(1), 4, h - 4);
    }

    resize();

    const off = controller.onFrame((metrics) => {
      const series = metrics[metricName];
      if (!series || series.t.length < 2) return;

      const { t, v } = series;
      const tMin = t[0];
      const tMax = t[t.length - 1];
      if (tMax <= tMin) return;

      const [lo, hi] = valueBounds(v, meta.yRange[0], meta.yRange[1]);
      lastLo = lo;
      lastHi = hi;
      lastGrid = bucketize(t, v, tMin, tMax, HEATMAP_COLS, lo, hi, HEATMAP_BUCKETS);
      render(lastGrid, lo, hi);
    });

    const ro = new ResizeObserver(() => {
      resize();
      if (lastGrid) render(lastGrid, lastLo, lastHi);
    });
    ro.observe(canvas);

    return () => {
      off();
      ro.disconnect();
    };
  });
</script>

<canvas bind:this={canvas} class="w-full block" style="height: {height}px"></canvas>

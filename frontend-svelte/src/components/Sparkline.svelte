<script lang="ts">
  type Props = {
    values: Float64Array;
    color: string;
    width?: number;
    height?: number;
  };

  let { values, color, width = 120, height = 36 }: Props = $props();

  // Cheap SVG polyline (no uPlot/canvas) — Overview shows 10 of these and they
  // only need to convey trend, not be interactive.
  const points = $derived.by(() => {
    const n = values.length;
    if (n === 0) return "";
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const x = values[i];
      if (x < min) min = x;
      if (x > max) max = x;
    }
    const range = max - min || 1;
    const step = n > 1 ? width / (n - 1) : 0;
    let out = "";
    for (let i = 0; i < n; i++) {
      const px = i * step;
      const py = height - ((values[i] - min) / range) * height;
      out += `${i === 0 ? "" : " "}${px.toFixed(1)},${py.toFixed(1)}`;
    }
    return out;
  });
</script>

<svg
  viewBox={`0 0 ${width} ${height}`}
  preserveAspectRatio="none"
  class="h-9 w-full"
  aria-hidden="true"
>
  <polyline
    fill="none"
    stroke={color}
    stroke-width="1.5"
    stroke-linejoin="round"
    points={points}
  />
</svg>

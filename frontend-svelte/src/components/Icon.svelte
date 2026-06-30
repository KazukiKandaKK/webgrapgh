<script lang="ts">
  type Props = { name: string; size?: number };
  let { name, size = 16 }: Props = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === "overview"}
    <!--
      Dashboard layout: big widget top-left, two stacked right,
      wide widget bottom-left, small bottom-right.
    -->
    <rect x="3"  y="3"  width="9"  height="9"  rx="1.5" />
    <rect x="14" y="3"  width="7"  height="4"  rx="1"   />
    <rect x="14" y="9"  width="7"  height="3"  rx="1"   />
    <rect x="3"  y="14" width="12" height="7"  rx="1.5" />
    <rect x="17" y="14" width="4"  height="7"  rx="1"   />

  {:else if name === "metrics"}
    <!--
      Chart axes + ECG / pulse-style waveform:
      flat → spike up → spike down → flat
    -->
    <line x1="4"  y1="20" x2="4"  y2="4"  />
    <line x1="4"  y1="20" x2="20" y2="20" />
    <polyline
      points="4,14 6,14 7.5,7 9,7 10.5,19 12,19 13.5,11 15,11 16.5,16 20,16"
    />

  {:else if name === "containers"}
    <!--
      Three stacked rounded layers (container stack).
      Each layer has a status dot on the left.
    -->
    <rect x="4" y="3.5" width="16" height="5"  rx="1.5" />
    <rect x="4" y="9.5" width="16" height="5"  rx="1.5" />
    <rect x="4" y="15.5" width="16" height="5" rx="1.5" />
    <circle cx="7.5" cy="6"   r="1" fill="currentColor" stroke="none" />
    <circle cx="7.5" cy="12"  r="1" fill="currentColor" stroke="none" />
    <circle cx="7.5" cy="18"  r="1" fill="currentColor" stroke="none" />

  {:else if name === "explore"}
    <!--
      Graph / network: centre hub connected to four leaf nodes.
      Leaf nodes are smaller circles.
    -->
    <circle cx="12" cy="12" r="3"   />
    <circle cx="4"  cy="6"  r="1.8" />
    <circle cx="20" cy="6"  r="1.8" />
    <circle cx="4"  cy="18" r="1.8" />
    <circle cx="20" cy="18" r="1.8" />
    <line x1="9.2"  y1="10.1" x2="5.7"  y2="7.5"  />
    <line x1="14.8" y1="10.1" x2="18.3" y2="7.5"  />
    <line x1="9.2"  y1="13.9" x2="5.7"  y2="16.5" />
    <line x1="14.8" y1="13.9" x2="18.3" y2="16.5" />

  {:else if name === "logs"}
    <!--
      Terminal log stream: prompt chevron + text lines at two depths.
    -->
    <polyline points="4,8 6.5,10.5 4,13" />
    <line x1="8.5" y1="10.5" x2="20"   y2="10.5" />
    <polyline points="4,16 6.5,18.5 4,21" opacity="0.5" />
    <line x1="8.5" y1="18.5" x2="16"   y2="18.5" opacity="0.5" />
    <!-- blinking cursor block -->
    <rect x="16.5" y="17" width="3" height="2"
          fill="currentColor" stroke="none" opacity="0.8" />

  {:else if name === "alerts"}
    <!--
      Diamond (rotated square) with exclamation mark inside.
    -->
    <path d="M12 2 L22 12 L12 22 L2 12 Z" />
    <line x1="12" y1="8.5" x2="12" y2="14" />
    <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />

  {:else if name === "snapshots"}
    <!--
      Film strip frame with aperture circle inside.
      Sprocket holes on both sides, concentric circles for aperture.
    -->
    <rect x="5" y="3" width="14" height="18" rx="1.5" />
    <!-- sprocket holes -->
    <rect x="2.5" y="6.5"  width="2.5" height="3" rx="0.5" fill="currentColor" stroke="none" />
    <rect x="2.5" y="14.5" width="2.5" height="3" rx="0.5" fill="currentColor" stroke="none" />
    <rect x="19"  y="6.5"  width="2.5" height="3" rx="0.5" fill="currentColor" stroke="none" />
    <rect x="19"  y="14.5" width="2.5" height="3" rx="0.5" fill="currentColor" stroke="none" />
    <!-- aperture -->
    <circle cx="12" cy="12" r="4"   />
    <circle cx="12" cy="12" r="1.5" />

  {:else if name === "heatmap"}
    <!--
      4×4 grid of filled squares with varying opacity —
      simulates a real density heatmap.
    -->
    <g fill="currentColor" stroke="none">
      <rect x="3"  y="3"  width="4" height="4" opacity="0.15" />
      <rect x="8"  y="3"  width="4" height="4" opacity="0.45" />
      <rect x="13" y="3"  width="4" height="4" opacity="0.85" />
      <rect x="18" y="3"  width="4" height="4" opacity="1.0"  />
      <rect x="3"  y="8"  width="4" height="4" opacity="0.4"  />
      <rect x="8"  y="8"  width="4" height="4" opacity="1.0"  />
      <rect x="13" y="8"  width="4" height="4" opacity="0.7"  />
      <rect x="18" y="8"  width="4" height="4" opacity="0.3"  />
      <rect x="3"  y="13" width="4" height="4" opacity="0.7"  />
      <rect x="8"  y="13" width="4" height="4" opacity="0.35" />
      <rect x="13" y="13" width="4" height="4" opacity="0.55" />
      <rect x="18" y="13" width="4" height="4" opacity="0.85" />
      <rect x="3"  y="18" width="4" height="4" opacity="1.0"  />
      <rect x="8"  y="18" width="4" height="4" opacity="0.65" />
      <rect x="13" y="18" width="4" height="4" opacity="0.25" />
      <rect x="18" y="18" width="4" height="4" opacity="0.5"  />
    </g>

  {:else if name === "settings"}
    <!--
      Three horizontal sliders (equalizer).
      Each track is split by a filled-circle thumb at a different position.
    -->
    <line x1="3"    y1="7"  x2="6.5"  y2="7"  />
    <circle cx="9"  cy="7"  r="2.5" fill="currentColor" />
    <line x1="11.5" y1="7"  x2="21"   y2="7"  />

    <line x1="3"    y1="12" x2="13.5" y2="12" />
    <circle cx="16" cy="12" r="2.5" fill="currentColor" />
    <line x1="18.5" y1="12" x2="21"   y2="12" />

    <line x1="3"    y1="17" x2="9.5"  y2="17" />
    <circle cx="12" cy="17" r="2.5" fill="currentColor" />
    <line x1="14.5" y1="17" x2="21"   y2="17" />
  {/if}
</svg>

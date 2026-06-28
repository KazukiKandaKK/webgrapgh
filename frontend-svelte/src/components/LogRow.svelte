<script lang="ts">
  import { levelClass, formatLogTime } from "@shared/utils";

  type Props = {
    topPx: number;
    heightPx: number;
    id: number;
    timeMs: number;
    level: string;
    source: string;
    message: string;
  };

  let { topPx, heightPx, timeMs, level, source, message }: Props = $props();

  const time = $derived(formatLogTime(timeMs));
</script>

<div
  style="position:absolute; top:{topPx}px; left:0; right:0; height:{heightPx}px"
  class="flex items-center gap-3 border-b border-slate-800/60 px-4 hover:bg-slate-800/40"
>
  <span class="w-24 shrink-0 text-slate-500">{time}</span>
  <span class={`w-14 shrink-0 font-semibold ${levelClass(level)}`}>
    {level || "·"}
  </span>
  <span class="w-20 shrink-0 truncate text-slate-400">{source}</span>
  <span class="flex-1 truncate text-slate-200">{message}</span>
</div>

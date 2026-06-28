<script lang="ts">
  type Props = {
    label: string;
    state: string;
    detail?: string;
  };

  let { label, state, detail }: Props = $props();

  function pillColor(s: string): string {
    switch (s) {
      case "open":
        return "bg-emerald-500/20 text-emerald-300 border-emerald-700";
      case "error":
        return "bg-rose-500/20 text-rose-300 border-rose-700";
      default:
        return "bg-slate-500/20 text-slate-300 border-slate-700";
    }
  }
</script>

<span
  class={`rounded-full border px-3 py-1 text-xs font-medium ${pillColor(state)}`}
  title={detail ?? ""}
>
  {label}: {state}
</span>

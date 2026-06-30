<script lang="ts">
  import { onMount } from "svelte";
  import { snapshotStore } from "../lib/snapshots.svelte";
  import { settings } from "../lib/settings.svelte";

  type Props = { snapshotId: number };
  let { snapshotId }: Props = $props();

  const apiBase = settings.current.apiBase;

  let author = $state("");
  let body = $state("");
  let submitting = $state(false);
  let formError: string | null = $state(null);

  onMount(() => {
    snapshotStore.loadComments(apiBase, snapshotId);
  });

  function fmt(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    formError = null;
    if (body.trim() === "") {
      formError = "Comment cannot be empty";
      return;
    }
    if (body.length > 10000) {
      formError = "Comment too long (max 10,000 chars)";
      return;
    }
    submitting = true;
    try {
      await snapshotStore.submitComment(apiBase, snapshotId, author.trim(), body.trim());
      body = "";
      author = "";
    } catch (e) {
      formError = e instanceof Error ? e.message : "Failed to post comment";
    } finally {
      submitting = false;
    }
  }
</script>

<section class="flex flex-col gap-4">
  <h3 class="text-sm font-semibold text-slate-300 uppercase tracking-wide">
    Comments ({snapshotStore.commentsTotal})
  </h3>

  <form onsubmit={handleSubmit} class="flex flex-col gap-2">
    <input
      type="text"
      placeholder="Your name (optional)"
      bind:value={author}
      class="rounded bg-slate-800 border border-slate-700 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-500"
    />
    <textarea
      data-testid="comment-body-input"
      placeholder="Add a comment…"
      rows="3"
      bind:value={body}
      class="rounded bg-slate-800 border border-slate-700 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-500 resize-none"
    ></textarea>
    {#if formError}
      <p class="text-xs text-rose-400">{formError}</p>
    {/if}
    <button
      data-testid="comment-submit-button"
      type="submit"
      disabled={submitting}
      class="self-end rounded px-3 py-1.5 text-sm font-medium bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white transition"
    >
      {submitting ? "Posting…" : "Post"}
    </button>
  </form>

  <ol class="flex flex-col gap-3">
    {#each snapshotStore.comments as comment (comment.id)}
      <li class="rounded border border-slate-700 bg-slate-800/40 px-4 py-3">
        <div class="flex items-baseline gap-2 mb-1">
          <strong class="text-sm text-slate-200">{comment.author}</strong>
          <time class="text-[10px] text-slate-500">{fmt(comment.created_at)}</time>
        </div>
        <p class="text-sm text-slate-300 whitespace-pre-wrap">{comment.body}</p>
      </li>
    {/each}
  </ol>

  {#if snapshotStore.commentsHasMore}
    <button
      class="self-center text-xs text-slate-400 hover:text-slate-200 underline"
      onclick={() => snapshotStore.loadMoreComments(apiBase, snapshotId)}
    >
      Load more ({snapshotStore.commentsTotal - snapshotStore.comments.length} remaining)
    </button>
  {/if}
</section>

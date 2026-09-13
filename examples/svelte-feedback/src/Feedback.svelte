<script lang="ts">
  import { onMount } from 'svelte';
  import { feedbackController, type Session, type View } from './controller';
  let { session }: { session: Session } = $props();
  let target: HTMLDivElement;
  let view = $state<View>({ phase: 'loading' });
  let controller: ReturnType<typeof feedbackController> | undefined;
  onMount(() => {
    controller = feedbackController(target, session, 'svelte', value => { view = value; });
    void controller.open();
    // Synchronous onMount returns disposal; async work remains cancellable.
    return () => controller?.destroy();
  });
</script>
<div>
  {#if view.phase === 'loading'}<p role="status">Loading feedback…</p>{/if}
  {#if view.phase === 'error'}<div role="alert"><p>Could not load this collection.</p><button onclick={() => controller?.open()}>Try loading again</button></div>{/if}
  <div bind:this={target} hidden={view.phase !== 'ready'}></div>
  {#if view.phase === 'uncertain' || view.phase === 'retrying'}<div role="status"><p>Submission is unconfirmed. Retry the original answer with the same key; no edits are sent.</p><button disabled={view.phase === 'retrying'} onclick={() => controller?.retry()}>{view.phase === 'retrying' ? 'Retrying…' : 'Retry original submission'}</button></div>{/if}
  {#if view.phase === 'blocked'}<p role="alert">The API rejected this attempt. Check the collection, credentials and schema with the operator. No replacement response was created.</p>{/if}
  {#if view.phase === 'accepted' && view.receipt}<div><p role="status">Feedback accepted.</p><p>Receipt: <code data-testid="receipt">{view.receipt.responseId}</code></p><button onclick={() => controller?.readBack()}>Read it from the backend</button>{#if view.record}<pre data-testid="record" aria-live="polite">{view.record}</pre>{/if}</div>{/if}
</div>

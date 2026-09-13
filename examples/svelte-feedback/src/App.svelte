<script lang="ts">
  import Feedback from './Feedback.svelte';
  import type { Session } from './controller';
  let eligible = $state(false), open = $state(false);
  const session: Session = {};
  function show() { if (eligible) open = true; }
</script>
<header><strong>Fieldnotes · Svelte</strong><span>Local integration</span></header>
<main><p class="eyebrow">Order complete</p><h1>Good things<br/>are on their way.</h1><p>No purchase happened. This fictional checkout demonstrates an embedded survey in Svelte.</p>
  <section aria-labelledby="feedback-title"><h2 id="feedback-title">One quick question?</h2>
    <label class="eligibility"><input bind:checked={eligible} type="checkbox" disabled={open}/>I choose to try this optional feedback example</label>
    <div class="actions">{#if !open}<button disabled={!eligible} onclick={show}>Give feedback</button>{:else}<button class="close" onclick={() => open = false}>Close feedback</button>{/if}</div>
    {#if open}<Feedback {session}/>{:else}<p role="status">Feedback is closed.</p>{/if}
    <p class="note">Only synthetic answers. Unconfirmed submissions survive close/reopen in memory, but not a full reload. Reconcile an ambiguous result before starting over.</p>
  </section>
</main><footer>Local developer example · collection-only browser access · temporary storage</footer>

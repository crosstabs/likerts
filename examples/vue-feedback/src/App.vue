<script setup lang="ts">
import { markRaw, ref } from 'vue';
import Feedback from './Feedback.vue';
import type { Session } from './controller';
const eligible = ref(false), open = ref(false);
const session: Session = markRaw<Session>({});
function show() { if (eligible.value) open.value = true; }
</script>
<template>
  <header><strong>Fieldnotes · Vue</strong><span>Local integration</span></header>
  <main><p class="eyebrow">Order complete</p><h1>Good things<br/>are on their way.</h1><p>No purchase happened. This fictional checkout demonstrates an embedded survey in Vue.</p>
    <section aria-labelledby="feedback-title"><h2 id="feedback-title">One quick question?</h2>
      <label class="eligibility"><input v-model="eligible" type="checkbox" :disabled="open"/>I choose to try this optional feedback example</label>
      <div class="actions"><button v-if="!open" :disabled="!eligible" @click="show">Give feedback</button><button v-else class="close" @click="open = false">Close feedback</button></div>
      <Feedback v-if="open" :session="session"/>
      <p v-else role="status">Feedback is closed.</p>
      <p class="note">Only synthetic answers. Unconfirmed submissions survive close/reopen in memory, but not a full reload. Reconcile an ambiguous result before starting over.</p>
    </section>
  </main><footer>Local developer example · collection-only browser access · temporary storage</footer>
</template>

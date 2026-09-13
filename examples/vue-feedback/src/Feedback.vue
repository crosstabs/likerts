<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { feedbackController, type Session, type View } from './controller';
const props = defineProps<{ session: Session }>();
const target = ref<HTMLDivElement>();
const view = ref<View>({ phase: 'loading' });
let controller: ReturnType<typeof feedbackController> | undefined;
onMounted(() => {
  if (!target.value) return;
  controller = feedbackController(target.value, props.session, 'vue', value => { view.value = value; });
  void controller.open();
});
onUnmounted(() => controller?.destroy());
</script>

<template>
  <div>
    <p v-if="view.phase === 'loading'" role="status">Loading feedback…</p>
    <div v-if="view.phase === 'error'" role="alert"><p>Could not load this collection.</p><button @click="controller?.open()">Try loading again</button></div>
    <div ref="target" :hidden="view.phase !== 'ready'"></div>
    <div v-if="view.phase === 'uncertain' || view.phase === 'retrying'" role="status"><p>Submission is unconfirmed. Retry the original answer with the same key; no edits are sent.</p><button :disabled="view.phase === 'retrying'" @click="controller?.retry()">{{ view.phase === 'retrying' ? 'Retrying…' : 'Retry original submission' }}</button></div>
    <p v-if="view.phase === 'blocked'" role="alert">The API rejected this attempt. Check the collection, credentials and schema with the operator. No replacement response was created.</p>
    <div v-if="view.phase === 'accepted' && view.receipt"><p role="status">Feedback accepted.</p><p>Receipt: <code data-testid="receipt">{{ view.receipt.responseId }}</code></p><button @click="controller?.readBack()">Read it from the backend</button><pre v-if="view.record" data-testid="record" aria-live="polite">{{ view.record }}</pre></div>
  </div>
</template>

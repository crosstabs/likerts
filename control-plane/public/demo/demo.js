import { LikertsClient, mountSurvey } from './sdk/index.js';
import { examples } from './examples.js';

const host = document.getElementById('demo-survey');
const selector = document.getElementById('demo-example');
const state = document.getElementById('demo-state');
const result = document.getElementById('demo-result');
const schema = document.getElementById('demo-schema');
let cleanup;
let generation = 0;

function reset() {
  cleanup?.();
  const currentGeneration = ++generation;
  const collection = {
    id: '00000000-0000-4000-8000-000000000002',
    surveyId: '00000000-0000-4000-8000-000000000001',
    version: 1,
    placement: 'local-demo',
    schema: structuredClone(examples[selector.value]),
  };
  let sampleSubmission;
  // This transport deliberately never calls fetch or any other network API.
  // CSP connect-src 'none' independently prevents data connections on this page.
  const localTransport = async (input, init) => {
    if (init.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const path = new URL(String(input)).pathname;
    if (init.method !== 'POST' || path !== `/v1/collections/${collection.id}/responses`) {
      return new Response(JSON.stringify({ error: 'Local sample endpoint unavailable' }), { status: 404 });
    }
    sampleSubmission = JSON.parse(init.body);
    const receipt = {
      responseId: crypto.randomUUID(), collectionId: collection.id,
      accepted: true, chargedCents: 1,
    };
    return new Response(JSON.stringify(receipt), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    });
  };
  const client = new LikertsClient('https://local-sample.invalid', 'local-demo-no-credential', localTransport);
  schema.textContent = JSON.stringify(collection.schema, null, 2);
  result.textContent = 'No sample submitted yet.';
  state.textContent = 'Answer the survey to see a sample submission.';
  cleanup = mountSurvey(host, collection, client, receipt => {
    if (generation !== currentGeneration) return;
    result.textContent = JSON.stringify({
      mode: 'local sample — not sent or stored',
      actualCreditsUsed: 0,
      submission: sampleSubmission,
      simulatedReceipt: receipt,
    }, null, 2);
    state.textContent = 'Sample complete. No network request or charge. chargedCents in the simulated receipt illustrates the real API shape only.';
  }, { source: 'local-sdk-demo' }, {
    messages: { submit: 'Submit local sample', submitted: 'Sample complete — nothing was sent.', submitting: 'Preparing local sample…' },
  });
}
selector.addEventListener('change', reset);
document.getElementById('demo-reset').addEventListener('click', reset);
window.addEventListener('pagehide', () => cleanup?.(), { once: true });
reset();

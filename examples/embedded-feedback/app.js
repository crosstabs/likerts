import { LikertsClient, mountSurvey } from '/sdk/index.js';

const customer = document.getElementById('customer-view');
const operator = document.getElementById('operator-view');
const customerTab = document.getElementById('customer-tab');
const operatorTab = document.getElementById('operator-tab');
async function show(view) {
  const inspect = view === 'operator';
  customer.hidden = inspect;
  operator.hidden = !inspect;
  customerTab.classList.toggle('active', !inspect);
  operatorTab.classList.toggle('active', inspect);
  customerTab.setAttribute('aria-pressed', String(!inspect));
  operatorTab.setAttribute('aria-pressed', String(inspect));
  if (inspect) await refresh();
}
async function refresh() {
  const status = document.getElementById('operator-status');
  status.textContent = 'Reading responses from the local API…';
  try {
    const response = await fetch('/operator/responses');
    if (!response.ok) throw new Error('Response retrieval failed');
    const result = await response.json();
    document.getElementById('response-count').textContent = String(result.items.length);
    document.getElementById('stored-json').textContent = JSON.stringify(result, null, 2);
    status.textContent = result.items.length ? 'Retrieved from the backend. Match this response ID to the receipt.' : 'No responses yet. Submit an answer in the customer experience.';
  } catch { status.textContent = 'Could not read responses. Check that the local API is still running.'; }
}
customerTab.addEventListener('click', () => show('customer'));
operatorTab.addEventListener('click', () => show('operator'));
document.getElementById('inspect-response').addEventListener('click', () => show('operator'));
document.getElementById('back-to-customer').addEventListener('click', () => show('customer'));
document.getElementById('refresh-responses').addEventListener('click', refresh);

try {
  const response = await fetch('/demo/config');
  if (!response.ok) throw new Error('Demo not ready');
  const config = await response.json();
  const client = new LikertsClient(location.origin, config.collectionToken);
  const collection = await client.collection(config.collectionId);
  const host = document.getElementById('survey');
  host.replaceChildren();
  const cleanup = mountSurvey(host, collection, client, receipt => {
    document.getElementById('receipt-json').textContent = JSON.stringify(receipt, null, 2);
    document.getElementById('receipt').hidden = false;
    document.getElementById('inspect-response').focus();
  }, { placement: 'checkout_success', orderReference: 'sample-1048', source: 'embedded-feedback-example' }, {
    messages: { submit: 'Send feedback →', submitted: 'Feedback received. Thank you.', submitting: 'Sending to the local API…' },
  });
  window.addEventListener('pagehide', cleanup, { once: true });
} catch { document.getElementById('survey').textContent = 'Could not load the collection. Restart the local demo and reload this page.'; }

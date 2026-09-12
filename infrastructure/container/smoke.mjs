import assert from 'node:assert/strict';

const [baseUrl, phase, monitor] = process.argv.slice(2);
assert.ok(baseUrl && ['create', 'verify'].includes(phase), 'supply base URL and create|verify');
const headers = {
  authorization: 'Bearer likerts-container-smoke-service-token-v1',
  'content-type': 'application/json',
};
const health = await fetch(`${baseUrl}/health`);
assert.equal(health.status, 200);
assert.match(JSON.stringify(await health.json()), /postgres/);
assert.equal((await fetch(`${baseUrl}/v1/surveys`)).status, 401);

if (phase === 'create') {
  const response = await fetch(`${baseUrl}/v1/surveys`, {
    method: 'POST', headers,
    body: JSON.stringify({
      idempotencyKey: 'container-release-fixture',
      title: 'Container restart persistence',
      questions: [{ id: 'rating', type: 'scale', label: 'Rating', required: true, min: 1, max: 5 }],
    }),
  });
  assert.equal(response.status, 201, await response.text());
}

const response = await fetch(`${baseUrl}/v1/surveys`, { headers });
assert.equal(response.status, 200);
const data = await response.json();
const items = Array.isArray(data) ? data : data.items;
assert.equal(items.length, 1);
assert.equal(items[0].title, 'Container restart persistence');
assert.equal((await fetch(`${baseUrl}/v1/usage`, { headers })).status, 403);
if (monitor) {
  assert.equal((await fetch(`${baseUrl}/internal/metrics`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/internal/metrics`, {headers})).status, 401);
  const monitorHeaders={authorization:'Bearer synthetic-container-monitor-token-v1'};
  const metrics=await fetch(`${baseUrl}/internal/metrics`, {headers:monitorHeaders});
  assert.equal(metrics.status,200);
  assert.equal(metrics.headers.get('cache-control'),'no-store');
  const text=await metrics.text();
  assert.match(text,/likerts_http_requests_total\{route="\/v1\/surveys",method="GET",status_class="2xx"\}/);
  assert.ok(!text.includes('Container restart persistence'));
  assert.ok(!text.includes('/internal/metrics'));
  assert.ok(!text.includes('/health'));
  assert.equal((await fetch(`${baseUrl}/v1/surveys`,{headers:monitorHeaders})).status,401);
}
console.log(`Container ${phase}: durable storage, credential scope and HTTP reachability${monitor ? ', separate-token metrics authorization' : ''} passed`);

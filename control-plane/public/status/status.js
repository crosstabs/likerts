const summary = document.getElementById('summary');
const timestamp = document.getElementById('checked-at');
const list = document.getElementById('components');
const refresh = document.getElementById('refresh');
async function update() {
  refresh.disabled = true;
  try {
    const response = await fetch('/api/status', { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    if (!['reachable', 'degraded'].includes(result.status) || !Array.isArray(result.components)
      || !Number.isFinite(Date.parse(result.checkedAt))) throw new Error('invalid_status');
    const age = Date.now() - Date.parse(result.checkedAt);
    if (age > 120000 || age < -60000) throw new Error('stale_status');
    summary.textContent = result.status === 'reachable' ? 'All listed services are reachable' : 'A service check is failing';
    timestamp.textContent = `Checked ${new Date(result.checkedAt).toLocaleString()}. Results may be cached for 30 seconds.`;
    list.replaceChildren(...result.components.map(component => {
      const row = document.createElement('li'); const name = document.createElement('span'); const state = document.createElement('strong');
      name.textContent = component.name; state.textContent = component.status === 'reachable' ? 'Reachable' : 'Check failed';
      state.dataset.status = component.status; row.append(name, state); return row;
    }));
  } catch {
    summary.textContent = 'Current status is unavailable';
    timestamp.textContent = 'The checks could not be retrieved. Try again shortly.';
    list.replaceChildren();
  } finally { refresh.disabled = false; }
}
refresh.addEventListener('click', update);
update();

for (const button of document.querySelectorAll('.copy-code')) {
  button.addEventListener('click', async () => {
    const value = button.closest('.docs-code')?.querySelector('code')?.textContent;
    if (!value) return;
    const status = document.getElementById('copy-status');
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = 'Copied';
      if (status) status.textContent = 'Code copied to clipboard.';
      setTimeout(() => { button.textContent = 'Copy'; }, 2000);
    } catch {
      if (status) status.textContent = 'Clipboard unavailable. Select and copy the code manually.';
    }
  });
}
const filter = document.getElementById('api-filter');
const operations = [...document.querySelectorAll('.api-operation')];
filter?.addEventListener('input', () => {
  const query = filter.value.trim().toLowerCase();
  let count = 0;
  for (const operation of operations) {
    operation.hidden = !operation.dataset.search.toLowerCase().includes(query);
    if (!operation.hidden) count++;
  }
  document.getElementById('api-result-count').textContent = `${count} ${count === 1 ? 'operation' : 'operations'}${query ? ' matching your search' : ''}`;
});

// Transfer an admitted room without discarding its validated, connected client.
// Saved credentials alone still take the ordinary explicit Resume route.
export function createQuizLiveHandoff({ client, root, window: win, disposeCreator, loadLive = () => import('./ui.mjs') }) {
  const document = root.ownerDocument;
  let liveApp = null, pending = null, disposed = false, creatorDisposed = false;
  function closeCreator() {
    if (!creatorDisposed) { creatorDisposed = true; disposeCreator(); }
  }
  async function open() {
    if (disposed || liveApp) return;
    if (!client.state) { win.location.assign('/play'); return; }
    if (pending) return pending;
    pending = (async () => {
      const { mountLiveApp } = await loadLive();
      if (disposed) return;
      closeCreator();
      for (const href of ['/play/styles.css', '/play/quiz-live-styles.css', '/play/quiz-scene.css']) {
        if (document.querySelector('link[href="' + href + '"]')) continue;
        const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = href;
        document.head.append(stylesheet);
      }
      document.querySelector('link[href="/play/quiz-styles.css"]')?.remove();
      liveApp = mountLiveApp({ root, client, window: win });
      if (win.location.pathname !== '/play') win.history.replaceState(null, '', '/play');
    })();
    try { return await pending; } finally { pending = null; }
  }
  return {
    open,
    dispose() {
      if (disposed) return;
      disposed = true; closeCreator();
      if (liveApp) liveApp.dispose(); else client.dispose();
    },
  };
}

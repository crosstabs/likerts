import { QuizLibrary } from './quiz-library.mjs';
import { mountQuizApp } from './quiz-ui.mjs';
import { LiveClient } from './client.mjs';
import { createQuizLiveHandoff } from './quiz-handoff.mjs';
import { readEntryIntent } from './entry-intent.mjs';

let storage = null;
try { storage = window.localStorage; } catch { /* The UI explains unavailable local storage. */ }
const library = new QuizLibrary({ storage, locks: window.navigator.locks });
let session = null;
try { session = window.sessionStorage; } catch { /* Hosting requires recoverable session storage. */ }
const client = new LiveClient({ origin: window.location.origin, storage: session });
const handoff = createQuizLiveHandoff({ client, root: document.getElementById('app'), window, disposeCreator: () => app.dispose() });
const app = mountQuizApp({ root: document.getElementById('app'), library, window,
  entryIntent: readEntryIntent(window.location.href),
  hostQuiz: async quiz => { await client.createQuiz(quiz); return handoff.open(); },
  liveAccess: () => client.pendingAdmissionHint ? { pending: true } : client.state || client.resumeHint ? { pending: false } : null,
  recoverLive: async () => { if (client.pendingAdmissionHint) await client.recoverAdmission(); return handoff.open(); },
});
window.addEventListener('pagehide', () => handoff.dispose(), { once: true });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });

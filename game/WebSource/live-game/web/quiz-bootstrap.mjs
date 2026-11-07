import { QuizLibrary } from './quiz-library.mjs';
import { mountQuizApp } from './quiz-ui.mjs';
import { LiveClient } from './client.mjs';

let storage = null;
try { storage = window.localStorage; } catch { /* The UI explains unavailable local storage. */ }
const library = new QuizLibrary({ storage, locks: window.navigator.locks });
let session = null;
try { session = window.sessionStorage; } catch { /* Hosting requires recoverable session storage. */ }
const client = new LiveClient({ origin: window.location.origin, storage: session });
const openRoom = () => {
  // Keep in-memory access usable if credential persistence fails after admission.
  if (client.state && !client.persisted) {
    app.dispose();
    return import('./ui.mjs').then(({ mountLiveApp }) => {
      const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = '/play/styles.css'; document.head.append(stylesheet);
      const quizStyles = document.createElement('link'); quizStyles.rel = 'stylesheet'; quizStyles.href = '/play/quiz-live-styles.css'; document.head.append(quizStyles);
      const sceneStyles = document.createElement('link'); sceneStyles.rel = 'stylesheet'; sceneStyles.href = '/play/quiz-scene.css'; document.head.append(sceneStyles);
      const previous = document.querySelector('link[href="/play/quiz-styles.css"]'); previous?.remove();
      liveApp = mountLiveApp({ root: document.getElementById('app'), client, window });
    });
  }
  window.location.assign('/play');
};
let liveApp = null;
const app = mountQuizApp({ root: document.getElementById('app'), library, window,
  hostQuiz: async quiz => { await client.createQuiz(quiz); return openRoom(); },
  liveAccess: () => client.pendingAdmissionHint ? { pending: true } : client.state || client.resumeHint ? { pending: false } : null,
  recoverLive: async () => { if (client.pendingAdmissionHint) await client.recoverAdmission(); return openRoom(); },
});
window.addEventListener('pagehide', () => { app.dispose(); liveApp?.dispose(); if (!liveApp) client.dispose(); }, { once: true });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });

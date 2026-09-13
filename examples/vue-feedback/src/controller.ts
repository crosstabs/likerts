import { LikertsClient, LikertsError, mountSurvey, type Receipt, type Submission } from '@likerts/web';

export type Session = { pending?: { collectionId: string; submission: Submission }; receipt?: Receipt };
export type View = { phase: 'loading' | 'ready' | 'error' | 'uncertain' | 'blocked' | 'retrying' | 'accepted'; receipt?: Receipt; record?: string };
type Config = { apiOrigin: string; collectionId: string; collectionToken: string };

/** One controller belongs to one mounted component. Session belongs to its host. */
export function feedbackController(container: HTMLElement, session: Session, framework: string, change: (view: View) => void) {
  let alive = true;
  let generation = 0;
  let current = new AbortController();
  let dispose = () => {};
  let config: Config | undefined;
  let view: View = { phase: 'loading' };
  const emit = (next: View) => { if (alive) { view = next; change(next); } };
  const failure = (error: unknown): View['phase'] => error instanceof LikertsError && error.status >= 400
    && error.status < 500 && ![408, 425, 429].includes(error.status) ? 'blocked' : 'uncertain';

  async function open() {
    current.abort(); dispose();
    current = new AbortController();
    const signal = current.signal, run = ++generation;
    const valid = () => alive && !signal.aborted && run === generation;
    emit({ phase: 'loading' });
    try {
      const response = await fetch('/api/feedback/config', { cache: 'no-store', signal });
      if (!response.ok) throw new Error('Configuration unavailable');
      const value: Config = await response.json();
      if (!valid()) return;
      config = value;
      if (session.receipt) { emit({ phase: 'accepted', receipt: session.receipt }); return; }
      if (session.pending) { emit({ phase: 'uncertain' }); return; }
      const client = new LikertsClient(value.apiOrigin, value.collectionToken);
      const collection = await client.collection(value.collectionId, { signal });
      if (!valid()) return;
      const submit = client.submit.bind(client);
      client.submit = async (id, submission, options) => {
        session.pending = { collectionId: id, submission: structuredClone(submission) };
        try {
          const result = await submit(id, session.pending.submission, options);
          session.receipt = result; session.pending = undefined;
          return result;
        } catch (error) {
          if (valid()) emit({ phase: failure(error) });
          throw error;
        }
      };
      dispose = mountSurvey(container, collection, client, receipt => {
        if (valid()) emit({ phase: 'accepted', receipt });
      }, { screen: 'checkout', framework });
      emit({ phase: 'ready' });
    } catch { if (valid()) emit({ phase: 'error' }); }
  }
  async function retry() {
    const pending = session.pending, value = config, signal = current.signal;
    if (!alive || signal.aborted || !pending || !value || pending.collectionId !== value.collectionId) return;
    emit({ phase: 'retrying' });
    try {
      const receipt = await new LikertsClient(value.apiOrigin, value.collectionToken)
        .submit(pending.collectionId, pending.submission, { signal });
      session.receipt = receipt; session.pending = undefined;
      if (!signal.aborted) emit({ phase: 'accepted', receipt });
    } catch (error) { if (!signal.aborted) emit({ phase: failure(error) }); }
  }
  async function readBack() {
    const receipt = session.receipt, signal = current.signal;
    if (!alive || !receipt || signal.aborted) return;
    emit({ ...view, record: 'Reading from the API…' });
    try {
      const response = await fetch(`/api/feedback/response?id=${encodeURIComponent(receipt.responseId)}`, { cache: 'no-store', signal });
      if (!response.ok) throw new Error('Retrieval failed');
      const result = await response.json();
      if (!signal.aborted) emit({ phase: 'accepted', receipt, record: JSON.stringify(result.response, null, 2) });
    } catch { if (!signal.aborted) emit({ ...view, record: 'Could not retrieve the response. Try again.' }); }
  }
  return { open, retry, readBack, destroy() { alive = false; generation++; current.abort(); dispose(); } };
}

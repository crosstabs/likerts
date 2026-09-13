'use client';

import { useEffect, useRef, useState } from 'react';
import { LikertsClient, LikertsError, mountSurvey, type Receipt } from '@likerts/web';
import { useFeedbackSession } from './session';

type Config = { apiOrigin: string; collectionId: string; collectionToken: string };
type State = 'idle' | 'loading' | 'ready' | 'error' | 'uncertain' | 'blocked' | 'retrying' | 'accepted';

export function Feedback() {
  const session = useFeedbackSession();
  const container = useRef<HTMLDivElement>(null);
  const config = useRef<Config | null>(null);
  const [state, setState] = useState<State>('idle');
  const [attempt, setAttempt] = useState(0);
  const [receipt, setReceipt] = useState<Receipt | undefined>(session.receipt);
  const [record, setRecord] = useState('');
  const lifetime = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!attempt) return;
    const abort = new AbortController();
    lifetime.current = abort;
    let cleanup = () => {};
    setState('loading');
    async function open() {
      try {
        const response = await fetch('/api/feedback/config', { cache: 'no-store', signal: abort.signal });
        if (!response.ok) throw new Error('Configuration unavailable');
        const value: Config = await response.json();
        if (abort.signal.aborted) return;
        config.current = value;
        if (session.receipt) { setReceipt(session.receipt); setState('accepted'); return; }
        if (session.pending) { setState('uncertain'); return; }
        const client = new LikertsClient(value.apiOrigin, value.collectionToken);
        const collection = await client.collection(value.collectionId, { signal: abort.signal });
        if (abort.signal.aborted || !container.current) return;
        const submit = client.submit.bind(client);
        client.submit = async (id, submission, options) => {
          // Copy once before the network call. Even navigation/abortion leaves
          // the same key and payload available to the explicit retry control.
          session.pending = { collectionId: id, submission: structuredClone(submission) };
          try {
            const result = await submit(id, session.pending.submission, options);
            session.receipt = result; session.pending = undefined;
            return result;
          } catch (error) {
            if (!abort.signal.aborted) setState(error instanceof LikertsError && error.status >= 400
              && error.status < 500 && ![408, 425, 429].includes(error.status) ? 'blocked' : 'uncertain');
            throw error;
          }
        };
        cleanup = mountSurvey(container.current, collection, client, result => {
          if (!abort.signal.aborted) { setReceipt(result); setState('accepted'); }
        }, { screen: 'checkout', framework: 'nextjs' });
        setState('ready');
      } catch {
        if (!abort.signal.aborted) setState('error');
      }
    }
    void open();
    return () => { abort.abort(); cleanup(); lifetime.current = null; };
  }, [attempt, session]);

  async function retryOriginal() {
    const pending = session.pending, value = config.current, signal = lifetime.current?.signal;
    if (!pending || !value || pending.collectionId !== value.collectionId) { setState('blocked'); return; }
    setState('retrying');
    try {
      const result = await new LikertsClient(value.apiOrigin, value.collectionToken)
        .submit(pending.collectionId, pending.submission, { signal });
      session.receipt = result; session.pending = undefined;
      if (!signal?.aborted) { setReceipt(result); setState('accepted'); }
    } catch (error) {
      if (!signal?.aborted) setState(error instanceof LikertsError && error.status >= 400
        && error.status < 500 && ![408, 425, 429].includes(error.status) ? 'blocked' : 'uncertain');
    }
  }

  async function readBack() {
    if (!receipt) return;
    const signal = lifetime.current?.signal;
    setRecord('Reading from the API…');
    try {
      const response = await fetch(`/api/feedback/response?id=${encodeURIComponent(receipt.responseId)}`,
        { cache: 'no-store', signal });
      if (!response.ok) throw new Error('Retrieval failed');
      const result = await response.json();
      if (!signal?.aborted) setRecord(JSON.stringify(result.response, null, 2));
    } catch { if (!signal?.aborted) setRecord('Could not retrieve the response. Try again.'); }
  }

  return <section aria-labelledby="feedback-title">
    <h2 id="feedback-title">One quick question?</h2>
    <p>You choose when to open feedback. This example sends synthetic answers to your local API.</p>
    {state === 'idle' && <button onClick={() => setAttempt(value => value + 1)}>Give feedback</button>}
    {state === 'loading' && <p role="status">Loading feedback…</p>}
    {state === 'error' && <div role="alert"><p>Could not load this collection.</p><button onClick={() => setAttempt(value => value + 1)}>Try loading again</button></div>}
    <div ref={container} hidden={state !== 'ready'} />
    {(state === 'uncertain' || state === 'retrying') && <div role="status"><p>Submission is unconfirmed. Retry the original answer with the same key; no edits are sent.</p><button disabled={state === 'retrying'} onClick={retryOriginal}>{state === 'retrying' ? 'Retrying…' : 'Retry original submission'}</button></div>}
    {state === 'blocked' && <p role="alert">The API rejected this attempt. Check the collection, credentials and schema with the operator before retrying. No replacement response was created.</p>}
    {state === 'accepted' && receipt && <div><p role="status">Feedback accepted.</p><p>Receipt: <code data-testid="receipt">{receipt.responseId}</code></p><button onClick={readBack}>Read it from the backend</button>{record && <pre data-testid="record" aria-live="polite">{record}</pre>}</div>}
    <p className="note">An unconfirmed attempt survives navigation within this app, in memory only. Reloading or closing the tab clears it; reconcile an ambiguous result with the operator before starting again.</p>
  </section>;
}

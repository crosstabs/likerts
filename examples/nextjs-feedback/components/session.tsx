'use client';

import { createContext, useContext, useRef, type ReactNode } from 'react';
import type { Receipt, Submission } from '@likerts/web';

type Session = { pending?: { collectionId: string; submission: Submission }; receipt?: Receipt };
const Context = createContext<Session | null>(null);

// The root layout survives client navigation. Keep an ambiguous attempt in memory
// so a remount can retry exactly that payload; do not persist answers in storage.
export function FeedbackSession({ children }: { children: ReactNode }) {
  const session = useRef<Session>({});
  return <Context.Provider value={session.current}>{children}</Context.Provider>;
}
export function useFeedbackSession() {
  const session = useContext(Context);
  if (!session) throw new Error('FeedbackSession is required.');
  return session;
}

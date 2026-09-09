import {LikertsClient, mountSurvey, type Receipt} from '@likerts/web';

// Call only after the host application's consent and eligibility checks.
export function attachCheckoutFeedback(button: HTMLButtonElement, container: HTMLElement,
  client: LikertsClient, collectionId: string, onComplete: (receipt: Receipt) => void) {
  let dispose = () => {};
  let loading: AbortController | undefined;
  const show = async () => {
    loading?.abort(); dispose();
    const current = new AbortController(); loading = current;
    try {
      const collection = await client.collection(collectionId, {signal: current.signal});
      if (!current.signal.aborted) dispose = mountSurvey(container, collection, client, onComplete, {placement: 'receipt'});
    } catch {
      if (!current.signal.aborted) container.textContent = 'Feedback is temporarily unavailable.';
    }
  };
  button.addEventListener('click', show);
  return () => {button.removeEventListener('click', show); loading?.abort(); dispose();};
}

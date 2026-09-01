import { useEffect, useRef, useState } from 'react';
import { ChatCircleDots, CheckCircle, PaperPlaneTilt, X } from '@phosphor-icons/react';

import { localizedFeedbackCopy } from '../lib/feedbackCopy.js';
import { trackPilotEvent } from '../lib/pilotAnalytics.js';
import { PRODUCT_FEEDBACK_VERSION } from '../../shared/product-feedback.mjs';

const FEEDBACK_CATEGORIES = Object.freeze([
  ['BUG', 'categoryBug'],
  ['CONFUSING', 'categoryConfusing'],
  ['IDEA', 'categoryIdea'],
  ['PRAISE', 'categoryPraise'],
  ['OTHER', 'categoryOther'],
]);

function currentPagePath() {
  const path = typeof window === 'undefined' ? '/' : window.location.pathname;
  return /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/.test(path) && path.length <= 160 ? path : '/';
}

export function FeedbackWidget({ uiLocale }) {
  const copy = localizedFeedbackCopy(uiLocale);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('');
  const [message, setMessage] = useState('');
  const [submissionState, setSubmissionState] = useState('idle');
  const triggerRef = useRef(null);
  const categoryRef = useRef(null);
  const successRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const focusFrame = window.requestAnimationFrame(() => categoryRef.current?.focus());
    const handleEscape = (event) => {
      if (event.key === 'Escape') closePanel();
    };
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (submissionState !== 'sent') return undefined;
    const focusFrame = window.requestAnimationFrame(() => successRef.current?.focus());
    return () => window.cancelAnimationFrame(focusFrame);
  }, [submissionState]);

  const openPanel = () => {
    setOpen(true);
    trackPilotEvent('feedback_opened', { locale: uiLocale });
  };

  const closePanel = () => {
    setOpen(false);
    setSubmissionState('idle');
    setCategory('');
    setMessage('');
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const submitFeedback = async (event) => {
    event.preventDefault();
    if (!category || message.trim().length < 3 || submissionState === 'sending') return;
    setSubmissionState('sending');

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({
          schemaVersion: PRODUCT_FEEDBACK_VERSION,
          category,
          message,
          interfaceLocale: uiLocale,
          pagePath: currentPagePath(),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.accepted !== true) throw new Error('feedback-not-accepted');
      setSubmissionState('sent');
      trackPilotEvent('feedback_submitted', { category, locale: uiLocale });
    } catch {
      setSubmissionState('error');
    }
  };

  return (
    <aside className="feedback-widget" aria-label={copy.trigger}>
      <button
        aria-controls="feedback-panel"
        aria-expanded={open}
        className="feedback-trigger"
        onClick={open ? closePanel : openPanel}
        ref={triggerRef}
        type="button"
      >
        <ChatCircleDots aria-hidden="true" size={19} weight="bold" />
        <span>{copy.trigger}</span>
      </button>

      {open ? (
        <section
          aria-labelledby="feedback-title"
          className="feedback-panel"
          id="feedback-panel"
          role="dialog"
        >
          <header className="feedback-panel-header">
            <div>
              <h2 id="feedback-title">{copy.title}</h2>
              <p>{copy.intro}</p>
            </div>
            <button aria-label={copy.close} className="feedback-close" onClick={closePanel} type="button">
              <X aria-hidden="true" size={18} weight="bold" />
            </button>
          </header>

          {submissionState === 'sent' ? (
            <div className="feedback-success" ref={successRef} role="status" tabIndex="-1">
              <CheckCircle aria-hidden="true" size={28} weight="fill" />
              <strong>{copy.successTitle}</strong>
              <p>{copy.successBody}</p>
              <button onClick={closePanel} type="button">{copy.done}</button>
            </div>
          ) : (
            <form className="feedback-form" onSubmit={submitFeedback}>
              <label htmlFor="feedback-category">{copy.categoryLabel}</label>
              <select
                id="feedback-category"
                onChange={(event) => setCategory(event.target.value)}
                ref={categoryRef}
                required
                value={category}
              >
                <option value="">{copy.categoryPlaceholder}</option>
                {FEEDBACK_CATEGORIES.map(([value, copyKey]) => (
                  <option key={value} value={value}>{copy[copyKey]}</option>
                ))}
              </select>

              <label htmlFor="feedback-message">{copy.messageLabel}</label>
              <textarea
                aria-describedby="feedback-privacy"
                id="feedback-message"
                maxLength={800}
                minLength={3}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={copy.messagePlaceholder}
                required
                rows={5}
                value={message}
              />
              <p className="feedback-privacy" id="feedback-privacy">{copy.privacy}</p>
              {submissionState === 'error' ? <p className="feedback-error" role="alert">{copy.error}</p> : null}
              <button className="feedback-submit" disabled={submissionState === 'sending'} type="submit">
                <PaperPlaneTilt aria-hidden="true" size={17} weight="bold" />
                {submissionState === 'sending' ? copy.sending : copy.send}
              </button>
            </form>
          )}
        </section>
      ) : null}
    </aside>
  );
}

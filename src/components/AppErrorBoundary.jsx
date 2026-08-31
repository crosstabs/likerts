import { Component } from 'react';

import { localizedCrashCopy } from '../lib/crashCopy.js';
import { reportClientError } from '../lib/clientErrorTelemetry.js';

export class AppErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    const reporter = this.props.reporter || reportClientError;
    reporter(error, { captureKind: 'react-boundary', action: 'render' });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const copy = localizedCrashCopy(globalThis.document?.documentElement?.lang);
    return (
      <div className="app-shell">
        <main className="workspace app-crash" role="alert">
          <h1>{copy.title}</h1>
          <p>{copy.body}</p>
          <button className="new-study-button" onClick={() => globalThis.location?.reload()} type="button">{copy.reload}</button>
        </main>
      </div>
    );
  }
}

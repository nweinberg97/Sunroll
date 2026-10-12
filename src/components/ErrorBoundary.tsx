import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** If a screen ever fails to render, say so plainly and offer a way back, instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  componentDidCatch(error: Error) {
    console.error('Sunroll screen error', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="wrap-narrow stack" style={{ paddingBlock: 72, textAlign: 'center', alignItems: 'center' }} role="alert">
        <span style={{ fontSize: 56 }} aria-hidden="true">
          🌧️
        </span>
        <h1 style={{ fontSize: 'var(--step-3)' }}>Something went wrong on this screen.</h1>
        <p className="muted">Your times are saved on the server whenever we said “Saved”. Reloading usually fixes this.</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}

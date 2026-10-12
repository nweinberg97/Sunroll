import { Link } from '../lib/router';

export default function NotFound() {
  return (
    <div className="wrap-narrow stack" style={{ paddingBlock: 80, textAlign: 'center', alignItems: 'center' }}>
      <span style={{ fontSize: 56 }} aria-hidden="true">
        🌘
      </span>
      <h1 style={{ fontSize: 'var(--step-3)' }}>Nothing rises here.</h1>
      <p className="muted">That page doesn’t exist. Maybe the link got cut off in the chat?</p>
      <Link to="/" className="btn btn-primary">
        Go home
      </Link>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/hooks';
import { navigate } from '../lib/router';
import { createDemo } from '../lib/demo';
import { setCredentials, setOrganizerToken } from '../lib/identity';
import { Spinner } from '../components/ui';

/** Builds a fresh demo event (you are Nadia) and opens it. */
export default function Demo() {
  const store = useStore();
  const started = useRef(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!store || started.current) return;
    started.current = true;
    createDemo(store)
      .then((d) => {
        setOrganizerToken(d.eventId, d.organizerToken);
        setCredentials(d.eventId, { participantId: d.participantId, token: d.participantToken });
        try {
          sessionStorage.setItem(`sunroll:demo:${d.eventId}`, '1');
        } catch {
          /* ignore */
        }
        navigate(`/e/${d.eventId}`, { replace: true });
      })
      .catch(() => setFailed(true));
  }, [store]);
  if (failed)
    return (
      <div className="wrap-narrow stack" style={{ paddingBlock: 64, textAlign: 'center' }}>
        <h1 style={{ fontSize: 'var(--step-3)' }}>We couldn’t set up the demo.</h1>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  return <Spinner label="Setting up the demo" />;
}

import { BOOKING_GUIDE, setGuideStep, useGuideStep } from '../lib/host/hooks';
import { navigate } from '../lib/router';

/** The step card for the guided booking demo. Shows only on its own step's page. */
export function GuideCard({ at }: { at: string }) {
  const step = useGuideStep();
  if (step === null) return null;
  const s = BOOKING_GUIDE[step];
  if (!s || !at.startsWith(s.path.split('?')[0])) return null;
  const last = step === BOOKING_GUIDE.length - 1;
  const go = (n: number) => {
    setGuideStep(n);
    const target = BOOKING_GUIDE[n];
    navigate(target.path);
  };
  return (
    <aside className="tour guide" aria-live="polite" aria-label="Guided demo">
      <div className="spread">
        <span className="demo-tag">
          Booking demo · step {step + 1} of {BOOKING_GUIDE.length}
        </span>
        <button type="button" className="link-btn muted small" onClick={() => setGuideStep(null)}>
          End demo
        </button>
      </div>
      <div className="tour-dots" aria-hidden="true">
        {BOOKING_GUIDE.map((_, i) => (
          <span key={i} data-on={i <= step || undefined} />
        ))}
      </div>
      <h2 className="tour-title">{s.title}</h2>
      <p className="tour-body">{s.body}</p>
      <div className="spread">
        <button type="button" className="btn btn-sm btn-ghost" disabled={step === 0} onClick={() => go(step - 1)}>
          ← Back
        </button>
        {s.waitFor === 'booking' ? (
          <span className="small muted" style={{ fontWeight: 700 }}>
            Book a time below to continue ↓
          </span>
        ) : last ? (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setGuideStep(null)}>
            Explore on my own
          </button>
        ) : (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => (s.next ? (setGuideStep(step + 1), navigate(s.next)) : go(step + 1))}>
            Next →
          </button>
        )}
      </div>
    </aside>
  );
}

import { BRAND } from '../lib/brand';

export default function Privacy() {
  return (
    <article className="wrap prose" style={{ paddingBlock: '32px 64px' }}>
      <h1>Privacy</h1>
      <p>
        <strong>The short version:</strong> {BRAND.name} collects a display name and a time zone, and nothing else. No accounts, no email addresses, no trackers. Events are deleted automatically.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>For each event: its name, emoji, the days and hours it covers, and the meeting length.</li>
        <li>For each person who adds their times: the name and emoji they choose, their time zone, the times they marked, any reactions, and (optionally) the usual sleeping and working hours they set to shade the grid.</li>
        <li>A secret key for the organizer and one for each person, stored only as one-way hashes, so we can tell it’s really you when you edit.</li>
        <li>A count of how many times an event link was opened. Just a number, nothing about who opened it.</li>
      </ul>

      <h2>What we don’t</h2>
      <ul>
        <li>No email, phone number, password or account.</li>
        <li>No advertising or third-party analytics scripts.</li>
        <li>No IP addresses stored. To stop abuse we count requests per network in hourly buckets, keyed by a one-way hash, and delete those counts within a day.</li>
      </ul>

      <h2>Who can see what</h2>
      <p>Anyone with an event’s link can see its name, the people in it, their time zones and their availability. Links are long and random, so they can’t be guessed, but treat them like a group chat: share them with the people you’re meeting. Only the organizer’s private link can lock the time, edit or delete the event.</p>

      <h2>How long we keep it</h2>
      <p>Every event, with everything in it, is deleted automatically {BRAND.retentionDays} days after its last date. The organizer can delete it at any time, and anyone can remove themselves.</p>

      <h2>On your device</h2>
      <p>Your browser remembers which events you’ve joined and the name you last used, so you don’t have to type it twice. Clearing your browser data removes it.</p>

      <h2>Questions</h2>
      <p>Open an issue on the project’s GitHub repository.</p>
    </article>
  );
}

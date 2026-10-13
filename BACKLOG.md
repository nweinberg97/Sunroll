# Sunroll backlog

Designed, not built. Each item says what it is, why it belongs in Sunroll, how it reuses what exists, and what it would cost. Nothing here ships until the core (find a time across time zones) is solid and shared links are live.

The thread through every item: **Sunroll is the scheduling tool that understands where everyone is.** A booking page, a customer session or a group call should all feel like the same product: your time zone, their time zone, and the time that works shown glowing.

---

## Where this fits

Sunroll today does one job: **a group finds one time** (friends, family, a small team).

Two more jobs would let a company use Sunroll for all of its scheduling:

| Mode | Who it's for | The question it answers |
|---|---|---|
| **Find a time** (live) | A group of friends or teammates | "When can all of us meet once?" |
| **Book me** (B1) | One person or team, and anyone who wants time with them | "When can I grab 30 minutes with you?" |
| **Sessions** (B2) | A company and many customers | "How do I meet 40 customers across the world in small groups, at humane hours for all of them?" |

**Book me** is table stakes: nobody replaces Calendly without it. **Sessions** is the reason to switch. No mainstream scheduling tool takes a big, spread-out audience and turns it into a handful of well-timed small group calls. That job needs exactly what Sunroll already has: a time engine across zones, availability overlap, and fairness ranking.

---

## B1. Book me: personal and team booking links

**What.** A page at `sunroll.app/nadia` (or `/acme/onboarding`) showing your open times in the visitor's time zone. The visitor picks a slot and enters a name and email. The meeting goes on both calendars with a Google Meet link already in it.

**What makes it Sunroll, not another Calendly.**
- **Your day next to theirs.** Each open slot also shows what it means for you ("9:00 am for you · 6:00 pm for Nadia"), on the same Sunband lanes as the overlap view. Visitors stop booking you at midnight by accident.
- **Humane hours by default.** You set working hours once. The page never offers times outside them, and it tells far-away visitors plainly: "Nadia's mornings are your evenings. Here's what's left."
- **Event types:** a 15-minute intro, a 30-minute call, or a 60-minute deep dive. Each has its own length, buffer, notice period and daily limit.
- **Team links** (later): round-robin, or "any of us", across teammates in different zones. A team spread over three zones covers far more of the day, which Sunroll can show as one combined Sunband.

**How it reuses what exists.**
- Slots, wall-time conversion, DST notes, the .ics export and the share card all exist already.
- The "Seeing times for" switch becomes "your time / my time" on a booking page.

**What's new.**
- **Accounts** (sign in with Google): needed to hold calendar access. Guests still never need one.
- **Calendar connection, read and write.** Free/busy to hide busy times (already planned for v2), and writing the booked event with `conferenceData.createRequest`, which makes Google create the Meet link. Microsoft 365 / Teams and Zoom come after Google.
- **Bookings data:** `accounts`, `calendar_connections` (tokens encrypted at rest; minimum scopes), `booking_pages`, `event_types`, `bookings`.
- **Server work:** booking has to be atomic (no two people grab the same slot), so it needs a server function that re-checks free/busy at the moment of booking.
- **Emails:** confirmation, a reschedule/cancel link, and reminders. This is the first time Sunroll collects email, so it collects it only for bookings, with that purpose said plainly on the form.

**Size.** Medium-large. Most of the cost is accounts, OAuth and calendar write, not the page.

---

## B2. Sessions: meet your customers in small groups, across the world

The founder's use case: "I want to talk to my customers at scale. Group them up for feedback and community. They're all over the world."

**What.** You create a **Session series**, for example "Customer roundtable · October". You set:
- the group size (say 4–8 people);
- the length (45 minutes);
- the dates it may run;
- your team's available hours.

You share one link (by email, in-product, or in a newsletter). Each customer opens it in their own time zone and either:
- **marks every time they could make** (best for grouping), or
- **picks one session** from a short list Sunroll proposes (simplest for them).

Sunroll then **forms the groups.** It finds the smallest set of sessions that covers the most customers, with every group within everyone's humane hours and within your team's hours. Each customer gets one invite, with a Meet link, at a good local time.

**Why this is Sunroll's edge.**
- **The overlap engine, at scale.** Today Sunroll finds the best time for one group. Sessions finds the best *few* times for a crowd and assigns people to them. It's the same scoring (availability, then humane hours) run as a grouping problem.
- **Fair by design.** No customer in Sydney is put on a 2 am call because HQ is in Vancouver. The world is covered by a "follow the sun" set of sessions, and the organizer sees the cost to their own team (who stays up late for which session) before confirming.
- **Visual.** The organizer sees a world view: one Sunband per region, the proposed sessions as golden windows, and dots for customers dropping into them as they respond. It's the landing-page hero turned into a working tool.

**The organizer's flow.**
1. **Set up:** name, group size, length, dates, team hours. Optionally, mix customers by plan or segment, or keep them together.
2. **Invite:** one link, plus copy-ready email text. The customer page is the same friendly paint-or-pick flow as today, in their language and time zone.
3. **Watch it fill:** a live map of who's responded and from where, with draft sessions forming.
4. **Review the proposal:** "6 sessions cover 38 of 41 customers. 3 can't make any humane time. Offer them a 1:1 booking link instead?" That last option links straight to B1.
5. **Confirm:** invites go out with Meet links, a host on each from your team (round-robin), and reminders.
6. **After:** attendance, a thank-you with the next roundtable's link, and (later) an optional AI summary of the notes (see B3).

**The grouping problem, plainly.** Given each customer's available slots, a group size range, and the team's hours: choose session times and assign each customer to at most one session. Maximise the number of customers placed, then minimise people outside humane hours, then minimise the number of sessions. A greedy approach is good enough and explainable for tens to a few hundred people:
1. Pick the slot that the most unplaced customers can make (ties go to the slot that's humane for more of them).
2. Fill it up to the group cap.
3. Repeat.
4. Rebalance tiny groups.

All of this lives in pure functions like the existing fairness engine, and is tested the same way. Each decision can be explained in a sentence ("Session 3 is 7 pm in Lagos and 11 am in Vancouver: everyone in it is inside their working day").

**Customer privacy.** Customers in a session see first names and cities by default, never each other's email addresses. The organizer chooses whether names show at all. Customer data belongs to the company. Retention is configurable, with 90 days after the series as the default.

**Size.** Large. It needs B1's accounts and calendar writing, plus the grouping engine, the organizer world view and email delivery. The grouping engine itself is small and could be prototyped first, entirely offline, against the demo data.

---

## B3. AI helpers (only where they save real work)

Each one is opt-in, can be undone, and is clearly labelled.

- **Write the invite:** turns a one-line goal ("feedback on the new dashboard") into an invite email, in the company's voice.
- **Suggest the grouping:** explains trade-offs in plain words ("Splitting EMEA into two sessions gets 4 more people in, at the cost of one more host").
- **After the call:** if the team connects meeting notes or a transcript, it produces a short summary per session and themes across all sessions. It never records anything on its own.

These come last. Scheduling has to be excellent before AI is added on top.

---

## Smaller items

- **Recurring groups with fair rotation** (already in v2): rotate the inconvenient slot across weeks so it's never always the same person.
- **Zoom and Microsoft Teams links**, alongside Google Meet.
- **"Book me" widget:** embed the booking page on a website.
- **Reminders** by email (and later SMS), with the time in the recipient's zone and a note on clock-change days.
- **Webhooks / Zapier:** a booking or session confirmation sends data to a CRM.

---

## Order, and why

1. **Shared links live (Supabase).** Without this, nothing below works.
2. **Accounts plus Google Calendar connection.** These are the foundation for both B1 and B2, so they get built once and built well.
3. **B1 Book me (Google Meet).** This makes Sunroll usable every day, which is what earns the switch from Calendly.
4. **B2 Sessions.** This is the differentiator, built on 2 and 3. Prototype the grouping engine early with the demo data, since it's pure and cheap to try.
5. **B3 AI helpers**, once the flows they help with are proven.

## Open questions for you

- Is **Sessions** for any company (self-serve), or first for **your own** company's customers, so you can learn from it before opening it up?
- Should customers **paint their availability** (better groupings, more effort) or **pick from proposed sessions** (less effort, fewer people placed)? We could default to "pick" and offer "paint" as an option.
- Free versus paid: booking pages are often free elsewhere. Sessions is the natural place to charge.

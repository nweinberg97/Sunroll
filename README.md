# Sunroll

**Find the time that works everywhere.** Everyone marks when they're free, and Sunroll shows the whole group in *your* time zone. The times that work for everyone glow, and each slot shows what it means for every person ("9:00 am for you · 1:00 am for Tom 😴").

- Live site: https://nweinberg97.github.io/Sunroll/
- Try the guided demo: https://nweinberg97.github.io/Sunroll/demo
- Design: [`DESIGN.md`](./DESIGN.md) · Backlog: [`BACKLOG.md`](./BACKLOG.md)

## Run it locally

```bash
npm install
npm run dev
```

This needs no accounts or credentials. With no backend configured, Sunroll runs in **local mode**: events are stored in your browser, and changes sync live across tabs. Each tab acts as a separate person, and `?tz=Europe/London` on any URL makes that tab act as if it's in London.

Local mode can't share an event with another device. The app says so in the share sheet, and shows "not on this device" for links it doesn't have. To share for real, switch on Supabase (below).

### Tests

| Command | What it checks |
|---|---|
| `npm test` | Time engine, fairness, calendar export, local backend, demo (run with any `TZ`) |
| `npm run test:sql` | Database migrations and the secured API, against a real Postgres |
| `npm run typecheck` | TypeScript |
| `npm run e2e` | Two browsers against a local Supabase: create, share, join, live update, lock in (see below) |

Every push to `main` runs CI. Pushes to other branches run CI and the end-to-end test, but don't deploy.

## Switch on shared links (Supabase)

Do this once to make the live site work across people and devices. It takes about 10 minutes.

### 1. Create the project
1. Go to [supabase.com](https://supabase.com) → **New project**. Name it `sunroll` and pick the region closest to most of your users.
2. Save the database password somewhere safe. You only need it for the CLI.

### 2. Load the database
Install the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), then from this folder:

```bash
supabase login
supabase link --project-ref <your-project-ref>   # the ref is in the project URL: https://<ref>.supabase.co
supabase db push                                  # applies everything in supabase/migrations
```

To check it worked, open **Table Editor**. You should see `events`, `event_days`, `participants` and the other Sunroll tables, each with a lock icon (RLS on).

### 3. Point the site at it
1. In Supabase, open **Project Settings → API**. Copy the **Project URL** and the **anon / publishable key**.
   The anon key is meant to be public: the browser can only call Sunroll's locked-down database functions, never the tables directly.
2. In GitHub, open **Settings → Secrets and variables → Actions → Variables tab → New repository variable**. Add three variables:

   | Name | Value |
   |---|---|
   | `VITE_DATA_BACKEND` | `supabase` |
   | `VITE_SUPABASE_URL` | `https://<your-project-ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | the anon / publishable key |

3. Open **Actions → Deploy to GitHub Pages → Run workflow** (or push to `main`). When it finishes, the "Local mode" badge in the footer is gone and links work for everyone.

### 4. Automatic clean-up (pg_cron)
The third migration schedules a daily job that deletes events 90 days after their last date. `pg_cron` is available on every Supabase project, and `db push` turns it on. To check, run this in the **SQL Editor**:

```sql
select jobname, schedule from cron.job;   -- expect: sunroll-purge-expired | 17 4 * * *
```

If it's missing, enable **pg_cron** under **Database → Extensions** and run `supabase db push` again.

### 5. Live updates
Live updates and "Priya is adding her times…" use Supabase Realtime **broadcast** and **presence** on public channels. These messages carry no personal data; clients re-fetch through the secured functions. Nothing needs switching on. If you later enable **Realtime → "Private channels only"**, live updates stop until channel policies are added.

## Deploying elsewhere

GitHub Pages (above) serves the app as static files. Per-event link previews (a custom image showing who's in) need a host that can run server code, such as Vercel or Netlify. That's planned; see `BACKLOG.md`.

## Project layout

```
src/lib/time/        time engine: zones, slots, grids, clock changes (pure, tested)
src/lib/fairness/    best-time ranking and plain-language reasons (pure, tested)
src/lib/data/        DataStore interface + local and Supabase adapters
src/screens/         Landing, Create, Event, Demo, Templates, Privacy
supabase/migrations/ schema, secured API functions, retention, metrics
tests/sql/           database tests (run against real Postgres)
e2e/                 Playwright end-to-end tests
```

# Clearance Outreach

Automated appointment-setter system for building-clearance lead outreach.
Sends an intro text/email with building + company details, then follows up
daily with a declining "auction-style" price question until a lead agrees
on a number — which you submit as an offer for your boss to approve.
Leads are trackable grouped by day (round) and current asking price.

## How it works

```
Import leads (CSV/PDF) → attach to a "building" record
        ↓
POST /api/outreach/start → sends intro message (SMS and/or email)
        ↓
Daily cron (Render Cron Job) → POST /api/cron/daily-follow-up
   - finds every lead due for a follow-up
   - computes the next (lower) price via the pluggable pricing engine
   - sends the "would you take $X?" message
   - reschedules, or flags floor_reached if it hit the floor price
        ↓
Lead replies → inbound webhook logs it, halts auto follow-ups,
               status flips to 'replied' — human takes over
        ↓
You & the lead agree on a number → POST /api/offers
        ↓
Boss reviews in the dashboard → PATCH /api/offers/:id (approved/rejected)
```

Everything channel-specific (SMS via RingCentral, email via SMTP) goes
through the same `dispatch()` function in `src/lib/channels.js`, so a lead
can be `preferred_channel: 'sms' | 'email' | 'both'` and the rest of the
app doesn't care.

## 1. Local setup

```bash
git clone <your-repo-url>
cd clearance-outreach
npm install
cp .env.example .env   # fill in values, see below
```

You need a Postgres database. Easiest path: create a free Postgres
instance on Render first (Dashboard → New → PostgreSQL), copy its
"External Connection String" into `DATABASE_URL` in `.env`, then run:

```bash
npm run migrate
```

Start the server locally:

```bash
npm run dev
# → http://localhost:3000  (dashboard at /)
```

## 2. RingCentral setup (SMS channel)

1. Create a free developer account at https://developers.ringcentral.com
2. Create an app: **Server/NoAuth (JWT auth flow)**, with the **SMS** and
   **Read/Send SMS/MMS** permission scopes, plus **Subscriptions** for
   inbound webhooks.
3. Generate a JWT credential for the app (Dashboard → your app → Credentials).
4. Fill in `.env`:
   - `RC_CLIENT_ID`, `RC_CLIENT_SECRET` (from the app)
   - `RC_JWT` (the JWT you generated)
   - `RC_FROM_NUMBER` — an SMS-enabled RingCentral number on your account
   - `RC_WEBHOOK_URL` — your deployed URL + `/webhooks/ringcentral`
     (must be a real public HTTPS URL, so set this up **after** you deploy)
5. After deploying, register the inbound webhook once:
   ```bash
   node scripts/subscribe.js
   ```
   Subscriptions expire after 7 days by default (`expiresIn` in
   `src/lib/ringcentral.js`) — re-run this periodically, or wire it into
   a weekly Render Cron Job.

## 3. Email setup (optional, same framework)

Any SMTP provider works (SendGrid, Mailgun, Postmark, even Gmail with an
app password). Set `EMAIL_ENABLED=true` and the `SMTP_*` vars in `.env`.

For **inbound replies**, the easiest option is SendGrid's free Inbound
Parse: point an MX record at SendGrid, tell it to POST to
`https://your-app.onrender.com/webhooks/email?secret=<EMAIL_WEBHOOK_SECRET>`.
If you use a different provider, adjust the field names in
`src/routes/webhooks.js` (`from`, `text`) to match their payload format.

If you'd rather skip inbound email entirely, that's fine — outbound-only
email still works, and replies just land in your normal inbox for you to
handle manually and log via the API.

## 4. Deploy to Render

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, point it at the repo — `render.yaml`
   will create the web service, the cron job, and the Postgres database
   automatically.
3. After the first deploy, set the remaining env vars in the Render
   dashboard for the web service (RingCentral, email, company, pricing —
   see `.env.example`).
4. Set `SELF_URL` on the cron job service to your web service's URL.
5. Run `npm run migrate` once against the Render database (e.g. via
   Render's Shell tab, or locally pointed at the Render `DATABASE_URL`).
6. Run `node scripts/subscribe.js` once (locally, pointed at the deployed
   `RC_WEBHOOK_URL`) to register the inbound SMS webhook.

## 5. Daily workflow

**Add a clearance building:**
```bash
curl -X POST https://your-app.onrender.com/api/buildings \
  -H "x-api-key: $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"name":"123 Main St Warehouse","address":"123 Main St, Anytown","details":"Full racking, forklifts, office furniture clearance.","initial_price":25000,"floor_price":10000}'
```

**Import leads (CSV or PDF) for that building:**
```bash
curl -X POST "https://your-app.onrender.com/api/leads/import?building_id=1" \
  -H "x-api-key: $ADMIN_API_KEY" -F "file=@leads.csv"
```
CSV columns (any order, case-insensitive): `name, phone, email, company, notes, preferred_channel`

**Kick off today's new leads:**
```bash
curl -X POST "https://your-app.onrender.com/api/outreach/start?building_id=1" \
  -H "x-api-key: $ADMIN_API_KEY"
```

**Daily follow-ups** run automatically via the Render Cron Job — no
manual action needed. It only touches leads whose `next_follow_up_at`
has passed and who haven't replied yet.

**View leads grouped by day / price** — open the dashboard at `/` and
paste in your `ADMIN_API_KEY`, or:
```bash
curl "https://your-app.onrender.com/api/leads/grouped" -H "x-api-key: $ADMIN_API_KEY"
```

**Once a lead agrees on a price**, log it as an offer:
```bash
curl -X POST https://your-app.onrender.com/api/offers \
  -H "x-api-key: $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"lead_id":7,"proposed_price":14500,"submitted_by":"you","notes":"Wants pickup by Friday"}'
```

**Boss approves/rejects** from the dashboard, or:
```bash
curl -X PATCH https://your-app.onrender.com/api/offers/3 \
  -H "x-api-key: $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"status":"approved","reviewed_by":"boss"}'
```

## 6. Tuning the pricing model (currently a placeholder)

Everything lives in `src/lib/pricing.js` + the `PRICING_*` env vars:

- `PRICING_STRATEGY=percent` — knock off `PRICING_PERCENT_PER_DAY`% of the
  *current* price each round (compounding decline).
- `PRICING_STRATEGY=fixed` — knock off a flat `$PRICING_FIXED_PER_DAY` each round.
- `PRICING_STRATEGY=manual` — the cron job won't change the price; you
  update `current_price` yourself via `PATCH /api/leads/:id`.
- `PRICING_FLOOR_PERCENT` — default floor (% of the building's
  `initial_price`) if you don't set an explicit `floor_price` on the
  building. Once a lead's price would go at/below the floor, it sends one
  "best and final" message and stops auto-messaging (status `floor_reached`)
  so you can decide manually whether to keep negotiating.

Change these any time — no code changes needed for percent/fixed/manual.
If you want a totally different curve (e.g. steeper drops the first few
days, flattening out), that logic lives entirely in `computeNextPrice()`
in `src/lib/pricing.js`.

## Lead status lifecycle

`new → contacted → follow_up (repeats) → replied → negotiating → agreed
→ offer_submitted → approved | rejected`, with `floor_reached`, `cold`,
and `dead` as off-ramps. Any inbound reply immediately halts auto
follow-ups regardless of where a lead is in the cycle.

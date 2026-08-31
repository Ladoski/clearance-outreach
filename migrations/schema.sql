-- Clearance Outreach schema
-- Run via `npm run migrate`

CREATE TABLE IF NOT EXISTS buildings (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  details TEXT,                 -- free-text description used in the intro message
  initial_price NUMERIC(12,2) NOT NULL,
  floor_price NUMERIC(12,2),    -- optional hard floor; overrides pricing.floorPercentOfAsk if set
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  building_id INTEGER REFERENCES buildings(id) ON DELETE SET NULL,

  name TEXT,
  phone TEXT,                   -- E.164 format e.g. +15551234567
  email TEXT,
  company TEXT,
  notes TEXT,

  -- which channel(s) this lead can be reached on
  preferred_channel TEXT NOT NULL DEFAULT 'sms', -- 'sms' | 'email' | 'both'

  -- pricing/negotiation state
  current_price NUMERIC(12,2),
  day_count INTEGER NOT NULL DEFAULT 0,  -- how many outreach "rounds" sent so far

  -- lifecycle: new -> contacted -> follow_up -> replied -> negotiating
  --            -> agreed -> offer_submitted -> approved/rejected
  --            -> floor_reached | cold | dead
  status TEXT NOT NULL DEFAULT 'new',

  last_contacted_at TIMESTAMPTZ,
  next_follow_up_at TIMESTAMPTZ,

  agreed_price NUMERIC(12,2),   -- set manually once you & the lead land on a number

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_next_follow_up ON leads(next_follow_up_at);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,        -- 'sms' | 'email'
  direction TEXT NOT NULL,      -- 'outbound' | 'inbound'
  body TEXT NOT NULL,
  price_offered NUMERIC(12,2),  -- price mentioned in this message, if any
  provider_message_id TEXT,     -- RingCentral message id / email Message-ID
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_id);

CREATE TABLE IF NOT EXISTS offers (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  proposed_price NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_approval', -- pending_approval | approved | rejected
  submitted_by TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status);

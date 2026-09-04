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

-- ===================================================================
-- Call coaching + follow-up system (separate from the leads/pricing
-- flow above — this tracks PHONE CONTACTS, not price-negotiation leads)
-- ===================================================================

CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  name TEXT,
  phone TEXT,                    -- E.164, matched against RingCentral call log
  email TEXT,
  company TEXT,
  status TEXT NOT NULL DEFAULT 'new',   -- new | contacted | engaged | follow_up | no_response | won | lost
  temperature TEXT NOT NULL DEFAULT 'warm', -- hot | warm | cold
  notes TEXT,
  last_contact_at TIMESTAMPTZ,
  next_follow_up_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_next_follow_up ON contacts(next_follow_up_at);
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);

CREATE TABLE IF NOT EXISTS calls (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  rc_call_id TEXT UNIQUE,         -- RingCentral's call session id, prevents duplicate sync
  direction TEXT,                 -- Inbound | Outbound
  phone_number TEXT,
  start_time TIMESTAMPTZ,
  duration_seconds INTEGER,
  recording_id TEXT,
  transcript TEXT,
  transcript_status TEXT NOT NULL DEFAULT 'pending', -- pending | processing | done | no_recording | failed
  last_error TEXT,                -- populated when transcript_status = 'failed', visible in the UI
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_calls_contact ON calls(contact_id);
CREATE INDEX IF NOT EXISTS idx_calls_start_time ON calls(start_time DESC);
ALTER TABLE calls ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE TABLE IF NOT EXISTS call_scores (
  id SERIAL PRIMARY KEY,
  call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  overall_score INTEGER,
  categories JSONB,               -- {opening, discovery, qualification, objection_handling, closing, communication}
  strengths JSONB,                -- array of strings
  weaknesses JSONB,                -- array of strings
  missed_opportunities JSONB,      -- array of strings
  customer_signals JSONB,           -- array of strings
  coaching_priority TEXT,
  next_call_recommendation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_call_scores_call ON call_scores(call_id);

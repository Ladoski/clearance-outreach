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
  call_status TEXT NOT NULL DEFAULT 'open',          -- open | pending | follow_up | won | lost | no_response
  call_category TEXT,                                -- sales_call | discovery | objection | closing | negotiation | demo
  is_model_call BOOLEAN DEFAULT false,               -- true if this call should be used as a reference/coaching example
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_calls_contact ON calls(contact_id);
CREATE INDEX IF NOT EXISTS idx_calls_start_time ON calls(start_time DESC);
ALTER TABLE calls ADD COLUMN IF NOT EXISTS call_status TEXT DEFAULT 'open';
ALTER TABLE calls ADD COLUMN IF NOT EXISTS call_category TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS is_model_call BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(call_status);
CREATE INDEX IF NOT EXISTS idx_calls_category ON calls(call_category);
CREATE INDEX IF NOT EXISTS idx_calls_model ON calls(is_model_call);

-- Call bank notes and follow-up templates
CREATE TABLE IF NOT EXISTS call_bank_notes (
  id SERIAL PRIMARY KEY,
  call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  bank_reason TEXT,                   -- why this call is in the bank (e.g., "excellent objection handling", "perfect discovery")
  text_option_1 TEXT,                 -- pre-drafted follow-up text for this call's situation
  text_option_2 TEXT,
  text_option_3 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_notes_call ON call_bank_notes(call_id);

-- Follow-up message sequences (predefined templates + timing)
CREATE TABLE IF NOT EXISTS follow_up_sequences (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,                    -- e.g., "Clearance Units Funnel"
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Individual messages in a sequence
CREATE TABLE IF NOT EXISTS follow_up_messages (
  id SERIAL PRIMARY KEY,
  sequence_id INTEGER NOT NULL REFERENCES follow_up_sequences(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,           -- 1, 2, 3, ... the order in the sequence
  hours_after_start INTEGER NOT NULL,    -- when to send (0, 23, 49, 71, 98, 119, 142, 163)
  message_text TEXT NOT NULL             -- the full SMS/email body
);
CREATE INDEX IF NOT EXISTS idx_messages_sequence ON follow_up_messages(sequence_id);

-- Tracks which contacts are enrolled in which sequence + send history
CREATE TABLE IF NOT EXISTS contact_follow_ups (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  sequence_id INTEGER NOT NULL REFERENCES follow_up_sequences(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,              -- NULL until sequence is done or paused
  last_sent_step INTEGER DEFAULT 0,      -- which step (1-based) was sent last
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contact_followups_contact ON contact_follow_ups(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_followups_sequence ON contact_follow_ups(sequence_id);

-- Logs each sent message (for history + deduplication)
CREATE TABLE IF NOT EXISTS follow_up_sends (
  id SERIAL PRIMARY KEY,
  contact_follow_up_id INTEGER NOT NULL REFERENCES contact_follow_ups(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL REFERENCES follow_up_messages(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  channel TEXT DEFAULT 'sms'             -- sms | email
);
CREATE INDEX IF NOT EXISTS idx_sends_contact_followup ON follow_up_sends(contact_follow_up_id);

-- Seed: Clearance Units funnel
INSERT INTO follow_up_sequences (name) VALUES ('Clearance Units Funnel')
ON CONFLICT DO NOTHING;

INSERT INTO follow_up_sequences (name) VALUES ('30x40 M Model Clearance')
ON CONFLICT DO NOTHING;

-- Messages for the funnel (only insert if sequence exists and is empty)
INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
SELECT fs.id, 1, 0, 'Hey {{contact.name}}, It''s Earle from Toro Steel Buildings. We got your request a while back for a steel building. The factory is clearing out these cancelled units due to a Canadian commercial client who cancelled their orders due to the tariffs, can you make any of this work at the right price ? • C-Channel or I-Beam Construction — no hollow tubing. 12 ga. Red Oxide Primed Columns & 24–26 ga. Galvalume Sheeting • 25–50 Year Warranty. Engineer-stamped and certified your local loads and codes. • Bolt together kit. Flatbed delivery. 100% hardware included. Pre-cut and pre-drilled, hand-welded in house Earle Hank ext 210 | https://torosteelbuildings.com Direct: (616) 229 8480 - 801 Broadway Ave, Grand Rapids, MI 21 factories for international delivery American mined and manufactured steel. Made in the USA since 1978 Testimonials: TORO Youtube page : https://youtube.com/watch?v=dd_dCrkYvW4 Bell Farms in Lewiston, ID : https://www.youtube.com/watch?v=lB9BGszE7zM A+ BBB rating : https://www.bbb.org/us/mi/grand-rapids/profile/commercial-building/toro-steel-buildings-0372-38280084'
FROM follow_up_sequences fs
WHERE fs.name = 'Clearance Units Funnel'
AND NOT EXISTS (SELECT 1 FROM follow_up_messages WHERE sequence_id = fs.id);

INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
SELECT fs.id, 2, 23, 'A few have already sold, and they are now open to offers on what''s left. Could you make any of these units work if they went considerably lower on the price ? Or what size were you after?'
FROM follow_up_sequences fs
WHERE fs.name = 'Clearance Units Funnel'
AND NOT EXISTS (SELECT 1 FROM follow_up_messages WHERE sequence_id = fs.id AND step_order = 2);

INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
SELECT fs.id, 3, 49, 'Please view the third last unit of 8 buildings due to the Canadian military boycotting American steel. First come, first served. ALL OFFERS TO BE REVIEWED M Model ~ 26'' x 10'' x 36'' 10''x8'' & 3''x7'' Framed Openings Original Invoice: $ 48,397.21 Balance: 26000 + delivery'
FROM follow_up_sequences fs
WHERE fs.name = 'Clearance Units Funnel'
AND NOT EXISTS (SELECT 1 FROM follow_up_messages WHERE sequence_id = fs.id AND step_order = 3);

INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
SELECT fs.id, 4, 71, 'If it was 25000 and we cover the freight would you take it?'
FROM follow_up_sequences fs
WHERE fs.name = 'Clearance Units Funnel'
AND NOT EXISTS (SELECT 1 FROM follow_up_messages WHERE sequence_id = fs.id AND step_order = 4);

INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
SELECT fs.id, 5, 98, 'Would you take it if my boss accepts 24 as an offer for the 26x36 structural steel building'
FROM follow_up_sequences fs
WHERE fs.name = 'Clearance Units Funnel'
AND NOT EXISTS (SELECT 1 FROM follow_up_messages WHERE sequence_id = fs.id AND step_order = 5);

INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
SELECT fs.id, 6, 119, 'My boss agreed to 23000 last night and we received the signed contract but the guy''s card declined on the deposit unfortunately. Would you take it at 22000 delivered?'
FROM follow_up_sequences fs
WHERE fs.name = 'Clearance Units Funnel'
AND NOT EXISTS (SELECT 1 FROM follow_up_messages WHERE sequence_id = fs.id AND step_order = 6);

INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
SELECT fs.id, 7, 142, 'if it was 19k delivered would you take the 26x36 red steel building ??'
FROM follow_up_sequences fs
WHERE fs.name = 'Clearance Units Funnel'
AND NOT EXISTS (SELECT 1 FROM follow_up_messages WHERE sequence_id = fs.id AND step_order = 7);

INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
SELECT fs.id, 8, 163, 'Would you take it if it was 15,800??'
FROM follow_up_sequences fs
WHERE fs.name = 'Clearance Units Funnel'
AND NOT EXISTS (SELECT 1 FROM follow_up_messages WHERE sequence_id = fs.id AND step_order = 8);

-- 30x40 M Model Clearance sequence
INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
SELECT fs.id, 1, 0, 'Hey {{contact.name}}, It''s Earle from Toro Steel Buildings. We got your request a while back for a steel building. The factory is clearing out this cancelled 30'' x 40'' x 14'' structural steel M Model due to a Canadian commercial client cancelling their order because of the tariffs. Could you make something like this work at the right price?
• M Model Structural Steel Construction — no hollow tubing. 12 ga. Red Oxide Primed Columns & 26 ga. Galvalume AZ Plus Sheeting
• Engineered & wet-stamped drawings — designed for your local loads and building codes
• Bolt-together kit — pre-cut and pre-drilled, with 100% of the materials and hardware needed to assemble
• Flatbed delivery directly to your property
• Openings: (2) 10'' x 12'' roll-up doors + (1) 3'' x 7'' entry door
• 14'' eave height / 16'' peak
• Engineered structural red oxide US steel
Retail Price: $79,914 + freight
Clearance Price: $47,760 + freight
First come, first served.
Earle Hank | ext. 210
Direct: (616) 229-8480
Toro Steel Buildings
801 Broadway Ave, Grand Rapids, MI
21 factories for international delivery
American mined and manufactured steel. Made in the USA since 1978.
Testimonials: TORO YouTube page
Bell Farms in Lewiston, ID
A+ BBB rating'
FROM follow_up_sequences fs
WHERE fs.name = '30x40 M Model Clearance'
AND NOT EXISTS (SELECT 1 FROM follow_up_messages WHERE sequence_id = fs.id AND step_order = 1);

INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
SELECT fs.id, 2, 23, 'A few have already sold, and they are now open to offers on what''s left. Could you make this 30'' x 40'' structural steel building work if they went considerably lower on the price? Or what size were you originally after?'
FROM follow_up_sequences fs
WHERE fs.name = '30x40 M Model Clearance'
AND NOT EXISTS (SELECT 1 FROM follow_up_messages WHERE sequence_id = fs.id AND step_order = 2);

INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
SELECT fs.id, 3, 49, 'I may be able to get my boss to sharpen the price a little more. If we could do $45,000 + freight, would you be interested in taking this 30'' x 40'' M Model?'
FROM follow_up_sequences fs
WHERE fs.name = '30x40 M Model Clearance'
AND NOT EXISTS (SELECT 1 FROM follow_up_messages WHERE sequence_id = fs.id AND step_order = 3);

INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
SELECT fs.id, 4, 71, 'I pushed again and got some movement. If we could get it down to $43,000 + freight, would that make it work for you?'
FROM follow_up_sequences fs
WHERE fs.name = '30x40 M Model Clearance'
AND NOT EXISTS (SELECT 1 FROM follow_up_messages WHERE sequence_id = fs.id AND step_order = 4);

INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
SELECT fs.id, 5, 98, 'I just spoke with my boss again. Would you take it at $41,000 + freight for the 30'' x 40'' structural steel building?'
FROM follow_up_sequences fs
WHERE fs.name = '30x40 M Model Clearance'
AND NOT EXISTS (SELECT 1 FROM follow_up_messages WHERE sequence_id = fs.id AND step_order = 5);

INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
SELECT fs.id, 6, 119, 'We''re getting close to the bottom on this one. If I could get $39,500 approved + freight, would you take it?'
FROM follow_up_sequences fs
WHERE fs.name = '30x40 M Model Clearance'
AND NOT EXISTS (SELECT 1 FROM follow_up_messages WHERE sequence_id = fs.id AND step_order = 6);

INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
SELECT fs.id, 7, 142, 'I may have one more shot at it. Would $38,000 + freight work for you?'
FROM follow_up_sequences fs
WHERE fs.name = '30x40 M Model Clearance'
AND NOT EXISTS (SELECT 1 FROM follow_up_messages WHERE sequence_id = fs.id AND step_order = 7);

INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
SELECT fs.id, 8, 163, 'Last number I''m going to try to get approved: $36,500 + freight. If I can get my boss to sign off on that, would you take the 30'' x 40'' building?'
FROM follow_up_sequences fs
WHERE fs.name = '30x40 M Model Clearance'
AND NOT EXISTS (SELECT 1 FROM follow_up_messages WHERE sequence_id = fs.id AND step_order = 8);
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

-- Campaign management (bulk lead import + tracking)
CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,                    -- e.g., "30x50 CDN Clearance Q4"
  region TEXT NOT NULL,                  -- "USA" or "Canada"
  sequence_id INTEGER NOT NULL REFERENCES follow_up_sequences(id) ON DELETE CASCADE,
  description TEXT,
  status TEXT DEFAULT 'active',          -- active | paused | completed
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_campaigns_region ON campaigns(region);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);

-- Tracks which leads are enrolled in which campaign
CREATE TABLE IF NOT EXISTS campaign_leads (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  contact_follow_up_id INTEGER REFERENCES contact_follow_ups(id) ON DELETE SET NULL,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_campaign ON campaign_leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_contact ON campaign_leads(contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_leads_unique ON campaign_leads(campaign_id, contact_id);

-- 30x50 CDN Clearance sequence
INSERT INTO follow_up_sequences (name) VALUES ('30x50 CDN Clearance')
ON CONFLICT DO NOTHING;

INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
SELECT fs.id, 1, 0, 'Hey {{contact.name}}, it''s Earle from Future/Toro Steel Buildings. We got your inquiry a while ago, but I know the timing wasn''t right for you. Maybe this could work now.
We have a cancelled 30'' x 50'' M Model available at a clearance price:
• 30'' x 50'' M Model
• 18'' eave height
• Structural steel construction
• Pre-engineered and ready to go
Original Sold Price: $71,167 + freight
Clearance Price: $42,700 + tax — or best offer
First come, first served.'
FROM follow_up_sequences fs
WHERE fs.name = '30x50 CDN Clearance'
AND NOT EXISTS (SELECT 1 FROM follow_up_messages WHERE sequence_id = fs.id);

INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
SELECT fs.id, 2, 23, 'Just wanted to follow up on this one. We''re getting offers on the remaining cancelled units. If the price was a little lower, could you make the 30'' x 50'' work?'
FROM follow_up_sequences fs WHERE fs.name = '30x50 CDN Clearance' AND NOT EXISTS (SELECT 1 FROM follow_up_messages WHERE sequence_id = fs.id AND step_order = 2);

INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
SELECT fs.id, 3, 49, 'I may be able to get some additional room on the price. If we could do $41,000 + tax, would you be interested?'
FROM follow_up_sequences fs WHERE fs.name = '30x50 CDN Clearance' AND NOT EXISTS (SELECT 1 FROM follow_up_messages WHERE sequence_id = fs.id AND step_order = 3);

INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
SELECT fs.id, 4, 71, 'I pushed them a little more on this one. Would $39,500 + tax work for you?'
FROM follow_up_sequences fs WHERE fs.name = '30x50 CDN Clearance' AND NOT EXISTS (SELECT 1 FROM follow_up_messages WHERE sequence_id = fs.id AND step_order = 4);

INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
SELECT fs.id, 5, 98, 'I just spoke with my boss again and got some more movement. Would you take the 30'' x 50'' M Model at $38,000 + tax?'
FROM follow_up_sequences fs WHERE fs.name = '30x50 CDN Clearance' AND NOT EXISTS (SELECT 1 FROM follow_up_messages WHERE sequence_id = fs.id AND step_order = 5);

INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
SELECT fs.id, 6, 119, 'We''re getting pretty aggressive on this one now. If I could get $36,500 + tax approved, would you take it?'
FROM follow_up_sequences fs WHERE fs.name = '30x50 CDN Clearance' AND NOT EXISTS (SELECT 1 FROM follow_up_messages WHERE sequence_id = fs.id AND step_order = 6);

INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
SELECT fs.id, 7, 142, 'I may have one more shot at getting this lowered. Would $35,000 + tax make it work for you?'
FROM follow_up_sequences fs WHERE fs.name = '30x50 CDN Clearance' AND NOT EXISTS (SELECT 1 FROM follow_up_messages WHERE sequence_id = fs.id AND step_order = 7);

INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
SELECT fs.id, 8, 163, 'Last number I''m going to try to get approved on this one: $33,500 + tax. If I can get that approved, would you take the 30'' x 50'' building?'
FROM follow_up_sequences fs WHERE fs.name = '30x50 CDN Clearance' AND NOT EXISTS (SELECT 1 FROM follow_up_messages WHERE sequence_id = fs.id AND step_order = 8);

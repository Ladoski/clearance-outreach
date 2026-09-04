const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { createInboundSubscription, sendSms } = require('../lib/ringcentral');

const router = express.Router();
router.use(requireAdmin);

/**
 * POST /api/admin/migrate
 * Applies migrations/schema.sql. Safe to call more than once — every
 * statement uses IF NOT EXISTS. This exists so free-tier Render users
 * (no Shell access) can set up the database without a terminal.
 */
router.post('/migrate', async (req, res) => {
  try {
    const sql = fs.readFileSync(
      path.join(__dirname, '..', '..', 'migrations', 'schema.sql'),
      'utf8'
    );
    await db.query(sql);
    res.json({ ok: true, message: 'Schema applied successfully.' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/admin/rc-subscribe
 * Registers (or re-registers) the RingCentral inbound SMS webhook.
 * Equivalent to running scripts/subscribe.js — exists here so free-tier
 * Render users without Shell access can trigger it via curl/browser.
 */
router.post('/rc-subscribe', async (req, res) => {
  try {
    const sub = await createInboundSubscription();
    res.json({ ok: true, subscription: sub });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/admin/test-sms  { to: "+15551234567", text: "hello" }
 * Sends one raw SMS through RingCentral, bypassing leads/pricing entirely.
 * Use this to confirm RingCentral credentials work before running real outreach.
 */
router.post('/test-sms', async (req, res) => {
  const { to, text } = req.body;
  if (!to || !text) {
    return res.status(400).json({ error: 'Both "to" and "text" are required in the JSON body' });
  }
  try {
    const result = await sendSms(to, text);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;

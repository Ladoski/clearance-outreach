const express = require('express');
const db = require('../lib/db');
const config = require('../config');

const router = express.Router();

/**
 * RingCentral inbound SMS webhook.
 * RingCentral sends a "validation-token" header on subscription creation
 * (echo it back once) and then POSTs message events as replies arrive.
 * Docs: https://developers.ringcentral.com/guide/notifications/webhooks
 */
router.post('/ringcentral', express.json(), async (req, res) => {
  const validationToken = req.headers['validation-token'];
  if (validationToken) {
    // Handshake: RC expects the token echoed back, then no further body.
    res.set('Validation-Token', validationToken);
    return res.status(200).end();
  }

  const body = req.body;
  const message = body?.body?.body || body; // RC event payload shape varies by subscription

  try {
    const fromNumber = message?.from?.phoneNumber || message?.body?.from?.phoneNumber;
    const text = message?.subject || message?.body?.subject || '';

    if (fromNumber) {
      const leadRes = await db.query('SELECT * FROM leads WHERE phone = $1 ORDER BY created_at DESC LIMIT 1', [fromNumber]);
      const lead = leadRes.rows[0];
      if (lead) {
        await db.query(
          `INSERT INTO messages (lead_id, channel, direction, body) VALUES ($1, 'sms', 'inbound', $2)`,
          [lead.id, text]
        );
        // Stop auto follow-ups the moment a human replies — hand off to the setter.
        await db.query(
          `UPDATE leads SET status = 'replied', next_follow_up_at = NULL, updated_at = now() WHERE id = $1`,
          [lead.id]
        );
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[webhooks/ringcentral] Failed to process inbound message:', err);
  }

  res.status(200).end();
});

/**
 * Email inbound webhook — shaped for SendGrid Inbound Parse
 * (https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/setting-up-the-inbound-parse-webhook),
 * which POSTs multipart/form-data with `from`, `subject`, `text` fields.
 * If you use a different provider (Mailgun, Postmark), adjust field names below.
 * Protect this route by putting a random path segment or the emailWebhookSecret
 * query param in the URL you register with your provider.
 */
router.post('/email', express.urlencoded({ extended: true, limit: '10mb' }), async (req, res) => {
  if (req.query.secret !== config.emailWebhookSecret) {
    return res.status(401).end();
  }

  try {
    const fromRaw = req.body.from || '';
    const emailMatch = fromRaw.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    const fromAddress = emailMatch ? emailMatch[0] : fromRaw;
    const text = req.body.text || req.body.html || '';

    if (fromAddress) {
      const leadRes = await db.query('SELECT * FROM leads WHERE email = $1 ORDER BY created_at DESC LIMIT 1', [fromAddress]);
      const lead = leadRes.rows[0];
      if (lead) {
        await db.query(
          `INSERT INTO messages (lead_id, channel, direction, body) VALUES ($1, 'email', 'inbound', $2)`,
          [lead.id, text]
        );
        await db.query(
          `UPDATE leads SET status = 'replied', next_follow_up_at = NULL, updated_at = now() WHERE id = $1`,
          [lead.id]
        );
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[webhooks/email] Failed to process inbound email:', err);
  }

  res.status(200).end();
});

module.exports = router;

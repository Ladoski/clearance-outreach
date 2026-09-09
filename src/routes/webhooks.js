const express = require('express');
const db = require('../lib/db');
const config = require('../config');

const router = express.Router();

/**
 * RingCentral inbound SMS webhook.
 * When a customer replies, save the message AND pause all active follow-up sequences.
 */
router.post('/ringcentral', express.json(), async (req, res) => {
  const validationToken = req.headers['validation-token'];
  if (validationToken) {
    res.set('Validation-Token', validationToken);
    return res.status(200).end();
  }

  const body = req.body;
  const message = body?.body?.body || body;

  try {
    const fromNumber = message?.from?.phoneNumber || message?.body?.from?.phoneNumber;
    const text = message?.subject || message?.body?.subject || '';

    if (fromNumber) {
      // Find contact by phone
      const contactRes = await db.query('SELECT * FROM contacts WHERE phone = $1 ORDER BY created_at DESC LIMIT 1', [fromNumber]);
      const contact = contactRes.rows[0];
      
      if (contact) {
        // Save inbound message
        await db.query(
          `INSERT INTO messages (contact_id, channel, direction, body) VALUES ($1, 'sms', 'inbound', $2)`,
          [contact.id, text]
        );

        // **CRITICAL: Pause all active follow-up sequences for this contact**
        await db.query(
          `UPDATE contact_follow_ups SET completed_at = now() WHERE contact_id = $1 AND completed_at IS NULL`,
          [contact.id]
        );

        // Update contact status to show they've replied
        await db.query(
          `UPDATE contacts SET status = 'replied', updated_at = now() WHERE id = $1`,
          [contact.id]
        );

        console.log(`[webhooks] Contact ${contact.name} (${fromNumber}) replied - stopped automated sequences`);
      }
    }
  } catch (err) {
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

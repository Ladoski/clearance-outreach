const db = require('./db');
const { sendSms } = require('./ringcentral');
const { sendEmail } = require('./email');
const templates = require('./templates');

/**
 * Sends the appropriate message(s) to a lead based on preferred_channel,
 * logs each attempt to the messages table, and returns what was sent.
 *
 * @param {Object} lead - row from `leads`, joined with building fields
 * @param {Object} building - row from `buildings`
 * @param {number} price
 * @param {'intro'|'followup'} kind
 * @param {boolean} atFloor
 */
async function dispatch(lead, building, price, kind, atFloor) {
  const results = [];
  const wantsSms = lead.preferred_channel === 'sms' || lead.preferred_channel === 'both';
  const wantsEmail = lead.preferred_channel === 'email' || lead.preferred_channel === 'both';

  if (wantsSms && lead.phone) {
    const text = kind === 'intro'
      ? templates.introMessage({ leadName: lead.name, building, price })
      : templates.followUpMessage({ leadName: lead.name, building, price, atFloor });
    try {
      const sent = await sendSms(lead.phone, text);
      await logMessage(lead.id, 'sms', 'outbound', text, price, sent.id);
      results.push({ channel: 'sms', ok: true });
    } catch (err) {
      results.push({ channel: 'sms', ok: false, error: err.message });
    }
  }

  if (wantsEmail && lead.email) {
    const content = kind === 'intro'
      ? templates.introEmail({ leadName: lead.name, building, price })
      : templates.followUpEmail({ leadName: lead.name, building, price, atFloor });
    try {
      const sent = await sendEmail(lead.email, content);
      await logMessage(lead.id, 'email', 'outbound', `${content.subject}\n\n${content.text}`, price, sent.id);
      results.push({ channel: 'email', ok: true });
    } catch (err) {
      results.push({ channel: 'email', ok: false, error: err.message });
    }
  }

  return results;
}

async function logMessage(leadId, channel, direction, body, priceOffered, providerMessageId) {
  await db.query(
    `INSERT INTO messages (lead_id, channel, direction, body, price_offered, provider_message_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [leadId, channel, direction, body, priceOffered ?? null, providerMessageId ?? null]
  );
}

module.exports = { dispatch, logMessage };

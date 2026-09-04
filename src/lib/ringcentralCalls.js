const db = require('./db');
const { getPlatform } = require('./ringcentral');
const config = require('../config');

/**
 * Finds an existing contact by phone number, or creates a new "new" contact.
 * Phone numbers are matched as-is (RingCentral returns E.164-ish numbers);
 * good enough for a single-operator tool.
 */
async function upsertContactForPhone(phoneNumber, name) {
  if (!phoneNumber) return null;

  const existing = await db.query('SELECT * FROM contacts WHERE phone = $1 LIMIT 1', [phoneNumber]);
  if (existing.rows[0]) return existing.rows[0];

  const { rows } = await db.query(
    `INSERT INTO contacts (name, phone, status, temperature)
     VALUES ($1, $2, 'new', 'warm') RETURNING *`,
    [name || phoneNumber, phoneNumber]
  );
  return rows[0];
}

/**
 * Pulls call log entries from RingCentral since `sinceISO`, saves any new
 * ones (matched by rc_call_id so re-running is safe), links/creates a
 * contact per call, and downloads any available recording's raw audio.
 *
 * Returns a summary + the list of newly-saved call rows (with recording
 * buffers attached in-memory only, NOT persisted to DB — the caller is
 * expected to transcribe them right away).
 */
async function syncRecentCalls(sinceISO) {
  const p = await getPlatform();

  const resp = await p.get('/restapi/v1.0/account/~/extension/~/call-log', {
    dateFrom: sinceISO,
    view: 'Detailed',
    withRecording: true,
    perPage: 100,
  });
  const json = await resp.json();
  const records = json.records || [];

  const newCalls = [];

  for (const rec of records) {
    // Skip if we already have this call
    const dupe = await db.query('SELECT id FROM calls WHERE rc_call_id = $1', [rec.id]);
    if (dupe.rows[0]) continue;

    const direction = rec.direction; // 'Inbound' | 'Outbound'
    const otherParty = direction === 'Inbound' ? rec.from : rec.to;
    const phoneNumber = otherParty && otherParty.phoneNumber;
    const name = otherParty && otherParty.name;

    const contact = await upsertContactForPhone(phoneNumber, name);

    const { rows } = await db.query(
      `INSERT INTO calls (contact_id, rc_call_id, direction, phone_number, start_time,
                           duration_seconds, recording_id, transcript_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        contact ? contact.id : null,
        rec.id,
        direction,
        phoneNumber || null,
        rec.startTime,
        rec.duration || null,
        rec.recording ? rec.recording.id : null,
        rec.recording ? 'pending' : 'no_recording',
      ]
    );
    const callRow = rows[0];
    newCalls.push({ call: callRow, recordingContentUri: rec.recording ? rec.recording.contentUri : null });

    // Bump the contact's last_contact_at so the follow-up center sees this
    if (contact) {
      await db.query(
        `UPDATE contacts SET last_contact_at = $1, status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END,
                              updated_at = now()
         WHERE id = $2`,
        [rec.startTime, contact.id]
      );
    }
  }

  return { fetched: records.length, newCalls };
}

/** Downloads the raw audio bytes for a call recording (needs RC auth). */
async function downloadRecording(contentUri) {
  const p = await getPlatform();
  const resp = await p.get(contentUri);
  const raw = resp.raw ? resp.raw() : resp; // RC SDK Response wrapper vs native fetch Response
  const arrayBuffer = await raw.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { syncRecentCalls, downloadRecording, upsertContactForPhone };

const db = require('./db');
const { ensureLoggedIn } = require('./ringcentral');
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
 * Pulls call log entries from RingCentral over a fixed lookback window
 * (config.callSync.lookbackHours — NOT just "since last check"), so that
 * calls which got stuck or failed on a previous attempt are re-discovered
 * and retried, not just brand-new calls.
 *
 * Returns every call in that window that still needs transcription/scoring
 * (status not 'done'), each paired with a fresh recording contentUri —
 * RingCentral media URLs can be short-lived, so we always re-fetch them
 * from the call log rather than trusting a stored one.
 */
async function syncRecentCalls() {
  const p = await ensureLoggedIn();
  const since = new Date(Date.now() - config.callSync.lookbackHours * 3600 * 1000).toISOString();

  const resp = await p.get('/restapi/v1.0/account/~/extension/~/call-log', {
    dateFrom: since,
    view: 'Detailed',
    withRecording: true,
    perPage: 100,
  });
  const json = await resp.json();
  const records = json.records || [];

  const toProcess = [];
  let newlyInserted = 0;

  for (const rec of records) {
    const direction = rec.direction; // 'Inbound' | 'Outbound'
    const otherParty = direction === 'Inbound' ? rec.from : rec.to;
    const phoneNumber = otherParty && otherParty.phoneNumber;
    const name = otherParty && otherParty.name;
    const recordingContentUri = rec.recording ? rec.recording.contentUri : null;

    let callRow;
    const existing = await db.query('SELECT * FROM calls WHERE rc_call_id = $1', [rec.id]);

    if (existing.rows[0]) {
      callRow = existing.rows[0];
    } else {
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
      callRow = rows[0];
      newlyInserted += 1;

      if (contact) {
        await db.query(
          `UPDATE contacts SET last_contact_at = $1, status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END,
                                updated_at = now()
           WHERE id = $2`,
          [rec.startTime, contact.id]
        );
      }
    }

    // Anything not already successfully scored, that has a recording available
    // right now, is a candidate to (re)process this run.
    if (callRow.transcript_status !== 'done' && recordingContentUri) {
      toProcess.push({ call: callRow, recordingContentUri });
    }
  }

  return { fetched: records.length, newlyInserted, toProcess };
}

/** Downloads the raw audio bytes for a call recording (needs RC auth). */
async function downloadRecording(contentUri) {
  const p = await ensureLoggedIn();
  const resp = await p.get(contentUri);
  const raw = resp.raw ? resp.raw() : resp; // RC SDK Response wrapper vs native fetch Response
  const arrayBuffer = await raw.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { syncRecentCalls, downloadRecording, upsertContactForPhone };

const db = require('./db');
const config = require('../config');

/**
 * Returns the follow-up center buckets. A contact only needs
 * next_follow_up_at OR a stale last_contact_at to show up here —
 * this stays simple on purpose (no separate follow_ups table yet).
 */
async function getFollowUpBuckets() {
  const { rows: contacts } = await db.query(
    `SELECT c.*,
            (SELECT overall_score FROM call_scores cs
              JOIN calls ON calls.id = cs.call_id
              WHERE calls.contact_id = c.id
              ORDER BY cs.created_at DESC LIMIT 1) AS last_call_score,
            (SELECT calls.start_time FROM calls WHERE calls.contact_id = c.id
              ORDER BY calls.start_time DESC LIMIT 1) AS last_call_time
     FROM contacts c
     WHERE c.status NOT IN ('won', 'lost')
     ORDER BY c.next_follow_up_at ASC NULLS LAST, c.last_contact_at ASC NULLS LAST`
  );

  const now = Date.now();
  const overdueMs = config.callFollowUp.hoursUntilOverdue * 3600 * 1000;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 3600 * 1000);
  const startOfDayAfter = new Date(startOfTomorrow.getTime() + 24 * 3600 * 1000);

  const buckets = { overdue: [], today: [], tomorrow: [], waiting_for_response: [], hot_leads: [] };

  for (const c of contacts) {
    if (c.temperature === 'hot') buckets.hot_leads.push(c);

    if (c.next_follow_up_at) {
      const t = new Date(c.next_follow_up_at).getTime();
      if (t < startOfToday.getTime()) buckets.overdue.push(c);
      else if (t < startOfTomorrow.getTime()) buckets.today.push(c);
      else if (t < startOfDayAfter.getTime()) buckets.tomorrow.push(c);
      continue;
    }

    // No explicit next_follow_up_at set: fall back to "has it gone quiet?"
    if (c.last_contact_at) {
      const sinceContact = now - new Date(c.last_contact_at).getTime();
      if (sinceContact > overdueMs && c.status !== 'follow_up') {
        buckets.waiting_for_response.push(c);
      }
    }
  }

  return buckets;
}

module.exports = { getFollowUpBuckets };

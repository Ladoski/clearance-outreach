const db = require('./db');
const { computeNextPrice } = require('./pricing');
const { dispatch } = require('./channels');
const config = require('../config');

/**
 * Finds every lead that:
 *  - is in a state that should still receive auto follow-ups
 *    (contacted, follow_up) — NOT replied/negotiating/agreed/etc.
 *  - has next_follow_up_at in the past (or null with day_count > 0, defensive)
 * Sends the next price down the ladder, logs it, and reschedules.
 * Leads that hit the floor get one final "best and final" message, then
 * flip to 'floor_reached' so they stop auto-messaging and need manual review.
 */
async function runDailyFollowUps() {
  const dueRes = await db.query(
    `SELECT leads.*, buildings.name AS building_name, buildings.address AS building_address,
            buildings.details AS building_details, buildings.initial_price AS building_initial_price,
            buildings.floor_price AS building_floor_price
     FROM leads
     JOIN buildings ON buildings.id = leads.building_id
     WHERE leads.status IN ('contacted', 'follow_up')
       AND leads.next_follow_up_at IS NOT NULL
       AND leads.next_follow_up_at <= now()`
  );

  const results = [];

  for (const lead of dueRes.rows) {
    const building = {
      name: lead.building_name,
      address: lead.building_address,
      details: lead.building_details,
    };

    // If already at floor from a prior round, stop auto-messaging.
    if (lead.status === 'floor_reached') continue;

    const { nextPrice, atFloor } = computeNextPrice({
      currentPrice: lead.current_price,
      initialPrice: lead.building_initial_price,
      buildingFloorPrice: lead.building_floor_price,
      dayCount: lead.day_count,
    });

    const sendResults = await dispatch(lead, building, nextPrice, 'followup', atFloor);

    const newStatus = atFloor ? 'floor_reached' : 'follow_up';
    const nextFollowUp = atFloor
      ? null
      : new Date(Date.now() + config.followUp.hoursBetweenFollowUps * 3600 * 1000);

    await db.query(
      `UPDATE leads
       SET status = $1, current_price = $2, day_count = day_count + 1,
           last_contacted_at = now(), next_follow_up_at = $3, updated_at = now()
       WHERE id = $4`,
      [newStatus, nextPrice, nextFollowUp, lead.id]
    );

    results.push({ lead_id: lead.id, price: nextPrice, atFloor, sendResults });
  }

  return { processed: results.length, results };
}

module.exports = { runDailyFollowUps };

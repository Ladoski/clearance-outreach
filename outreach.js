const express = require('express');
const db = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { computeNextPrice } = require('../lib/pricing');
const { dispatch } = require('../lib/channels');
const config = require('../config');

const router = express.Router();
router.use(requireAdmin);

/**
 * POST /api/outreach/start?building_id=1
 * Sends the intro message to every 'new' lead for a building and
 * schedules their first follow-up.
 */
router.post('/start', async (req, res) => {
  const buildingId = req.query.building_id;
  if (!buildingId) return res.status(400).json({ error: 'building_id query param is required' });

  const buildingRes = await db.query('SELECT * FROM buildings WHERE id = $1', [buildingId]);
  const building = buildingRes.rows[0];
  if (!building) return res.status(404).json({ error: 'building not found' });

  const leadsRes = await db.query(
    `SELECT * FROM leads WHERE building_id = $1 AND status = 'new'`,
    [buildingId]
  );

  const results = [];
  for (const lead of leadsRes.rows) {
    const { nextPrice, atFloor } = computeNextPrice({
      currentPrice: building.initial_price,
      initialPrice: building.initial_price,
      buildingFloorPrice: building.floor_price,
      dayCount: 0,
    });

    const sendResults = await dispatch(lead, building, nextPrice, 'intro', atFloor);

    const nextFollowUp = new Date(Date.now() + config.followUp.hoursBetweenFollowUps * 3600 * 1000);
    await db.query(
      `UPDATE leads
       SET status = 'contacted', current_price = $1, day_count = 1,
           last_contacted_at = now(), next_follow_up_at = $2, updated_at = now()
       WHERE id = $3`,
      [nextPrice, nextFollowUp, lead.id]
    );

    results.push({ lead_id: lead.id, price: nextPrice, sendResults });
  }

  res.json({ building_id: buildingId, contacted: results.length, results });
});

module.exports = router;

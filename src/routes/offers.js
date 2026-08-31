const express = require('express');
const db = require('../lib/db');
const { requireAdmin } = require('../lib/auth');

const router = express.Router();
router.use(requireAdmin);

/**
 * POST /api/offers  { lead_id, proposed_price, submitted_by, notes }
 * Call this once you & the lead have landed on a number over text/email.
 * Also flips the lead to 'offer_submitted' and stops auto follow-ups.
 */
router.post('/', async (req, res) => {
  const { lead_id, proposed_price, submitted_by, notes } = req.body;
  if (!lead_id || !proposed_price) {
    return res.status(400).json({ error: 'lead_id and proposed_price are required' });
  }

  const { rows } = await db.query(
    `INSERT INTO offers (lead_id, proposed_price, submitted_by, notes)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [lead_id, proposed_price, submitted_by || null, notes || null]
  );

  await db.query(
    `UPDATE leads SET status = 'offer_submitted', agreed_price = $1, next_follow_up_at = NULL, updated_at = now()
     WHERE id = $2`,
    [proposed_price, lead_id]
  );

  res.status(201).json(rows[0]);
});

// List offers, e.g. ?status=pending_approval for your boss's queue
router.get('/', async (req, res) => {
  const { status } = req.query;
  const params = [];
  let where = '';
  if (status) {
    params.push(status);
    where = 'WHERE status = $1';
  }
  const { rows } = await db.query(
    `SELECT offers.*, leads.name AS lead_name, leads.phone, leads.email
     FROM offers JOIN leads ON leads.id = offers.lead_id
     ${where} ORDER BY offers.created_at DESC`,
    params
  );
  res.json(rows);
});

// PATCH /api/offers/:id  { status: 'approved'|'rejected', reviewed_by }
router.patch('/:id', async (req, res) => {
  const { status, reviewed_by } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: "status must be 'approved' or 'rejected'" });
  }
  const { rows } = await db.query(
    `UPDATE offers SET status = $1, reviewed_by = $2, reviewed_at = now() WHERE id = $3 RETURNING *`,
    [status, reviewed_by || null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });

  if (status === 'approved') {
    await db.query(`UPDATE leads SET status = 'approved', updated_at = now() WHERE id = $1`, [rows[0].lead_id]);
  } else {
    // rejected: kick back to negotiating so the setter can re-engage with a new number
    await db.query(`UPDATE leads SET status = 'negotiating', updated_at = now() WHERE id = $1`, [rows[0].lead_id]);
  }

  res.json(rows[0]);
});

module.exports = router;

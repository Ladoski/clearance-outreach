const express = require('express');
const db = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { getLeadsByPriority, scoreAllLeads } = require('../lib/leadScoring');
const { findMatchingLeads } = require('../lib/inventoryMatching');

const router = express.Router();
router.use(requireAdmin);

// GET /api/dashboard - sales metrics for today
router.get('/', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];

  // Today's activity
  const { rows: todayMsgs } = await db.query(
    `SELECT COUNT(*) as count FROM messages WHERE DATE(created_at) = $1`,
    [today]
  );

  const { rows: activeOffers } = await db.query(
    `SELECT COUNT(*) as count FROM offers WHERE status = 'pending_approval'`
  );

  const { rows: leadsByStatus } = await db.query(`
    SELECT status, COUNT(*) as count FROM leads 
    WHERE status NOT IN ('dead', 'cold')
    GROUP BY status
  `);

  const { rows: avgScore } = await db.query(
    `SELECT AVG(score) as avg FROM lead_scores`
  );

  res.json({
    metrics: {
      messages_today: parseInt(todayMsgs[0]?.count || 0),
      active_offers: parseInt(activeOffers[0]?.count || 0),
      avg_lead_score: Math.round(avgScore[0]?.avg || 0),
    },
    leads_by_status: leadsByStatus.reduce((acc, row) => {
      acc[row.status] = parseInt(row.count);
      return acc;
    }, {}),
  });
});

// GET /api/dashboard/start-day - prioritized leads for today
router.get('/start-day', async (req, res) => {
  // Score all leads first
  await scoreAllLeads();

  // Get priority queue
  const leads = await getLeadsByPriority();

  // Enrich with last message
  const enriched = [];
  for (const lead of leads.slice(0, 30)) {
    const { rows: building } = await db.query(
      `SELECT * FROM buildings WHERE id = $1`,
      [lead.building_id]
    );
    
    enriched.push({
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      company: lead.company,
      status: lead.status,
      score: lead.score || 0,
      current_price: lead.current_price,
      agreed_price: lead.agreed_price,
      last_message: lead.last_message,
      unread_count: parseInt(lead.unread_count || 0),
      building: building[0] || null,
      last_contacted_at: lead.last_contacted_at,
      next_follow_up_at: lead.next_follow_up_at,
    });
  }

  res.json({
    queue: enriched,
    total: enriched.length,
  });
});

// GET /api/dashboard/lead/:id - full lead profile
router.get('/lead/:id', async (req, res) => {
  const { rows: lead } = await db.query(`SELECT * FROM leads WHERE id = $1`, [req.params.id]);
  if (!lead[0]) return res.status(404).json({ error: 'Not found' });

  const { rows: building } = await db.query(
    `SELECT * FROM buildings WHERE id = $1`,
    [lead[0].building_id]
  );

  const { rows: messages } = await db.query(
    `SELECT * FROM messages WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [req.params.id]
  );

  const { rows: offers } = await db.query(
    `SELECT * FROM offers WHERE lead_id = $1 ORDER BY created_at DESC`,
    [req.params.id]
  );

  const { rows: score } = await db.query(
    `SELECT * FROM lead_scores WHERE lead_id = $1`,
    [req.params.id]
  );

  res.json({
    lead: lead[0],
    building: building[0],
    messages,
    offers,
    score: score[0],
  });
});

// PATCH /api/dashboard/lead/:id - update lead status/notes
router.patch('/lead/:id', async (req, res) => {
  const { status, notes, current_price, agreed_price, next_follow_up_at } = req.body;
  
  const updates = [];
  const params = [];
  let paramNum = 1;

  if (status) {
    updates.push(`status = $${paramNum++}`);
    params.push(status);
  }
  if (notes !== undefined) {
    updates.push(`notes = $${paramNum++}`);
    params.push(notes);
  }
  if (current_price !== undefined) {
    updates.push(`current_price = $${paramNum++}`);
    params.push(current_price);
  }
  if (agreed_price !== undefined) {
    updates.push(`agreed_price = $${paramNum++}`);
    params.push(agreed_price);
  }
  if (next_follow_up_at !== undefined) {
    updates.push(`next_follow_up_at = $${paramNum++}`);
    params.push(next_follow_up_at);
  }

  updates.push(`updated_at = now()`);
  params.push(req.params.id);

  if (updates.length === 1) return res.status(400).json({ error: 'No fields to update' });

  const { rows } = await db.query(
    `UPDATE leads SET ${updates.join(', ')} WHERE id = $${paramNum} RETURNING *`,
    params
  );

  res.json(rows[0]);
});

module.exports = router;

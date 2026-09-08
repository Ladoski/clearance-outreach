const express = require('express');
const db = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { getLeadsByPriority, scoreAllLeads } = require('../lib/leadScoring');
const { findMatchingLeads } = require('../lib/inventoryMatching');

const router = express.Router();
router.use(requireAdmin);

// GET /api/dashboard - sales metrics for today
router.get('/', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Today's activity - messages table
    const { rows: todayMsgs } = await db.query(
      `SELECT COUNT(*) as count FROM messages WHERE DATE(created_at) = $1`,
      [today]
    ).catch(() => ({ rows: [{ count: 0 }] }));

    // Active offers
    const { rows: activeOffers } = await db.query(
      `SELECT COUNT(*) as count FROM offers WHERE status = 'pending'`
    ).catch(() => ({ rows: [{ count: 0 }] }));

    // Contacts by status
    const { rows: contactsByStatus } = await db.query(`
      SELECT status, COUNT(*) as count FROM contacts 
      WHERE status NOT IN ('dead', 'cold')
      GROUP BY status
    `).catch(() => ({ rows: [] }));

    res.json({
      metrics: {
        messages_today: parseInt(todayMsgs[0]?.count || 0),
        active_offers: parseInt(activeOffers[0]?.count || 0),
        avg_lead_score: 0,
      },
      leads_by_status: contactsByStatus.reduce((acc, row) => {
        acc[row.status] = parseInt(row.count);
        return acc;
      }, {}),
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.json({
      metrics: { messages_today: 0, active_offers: 0, avg_lead_score: 0 },
      leads_by_status: {},
    });
  }
});

// GET /api/dashboard/start-day - prioritized leads for today
router.get('/start-day', async (req, res) => {
  try {
    // Get priority queue from contacts
    const { rows: contacts } = await db.query(`
      SELECT c.*, 
             (SELECT COUNT(*) FROM messages WHERE contact_id = c.id AND direction = 'inbound') as unread_count,
             (SELECT body FROM messages WHERE contact_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message
      FROM contacts c
      WHERE c.status NOT IN ('dead', 'cold')
      ORDER BY 
        CASE WHEN c.status = 'negotiating' THEN 1
             WHEN c.status = 'replied' THEN 2
             ELSE 5
        END,
        c.last_contacted_at DESC NULLS LAST
      LIMIT 50
    `).catch(() => ({ rows: [] }));

    const enriched = contacts.map(c => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      company: c.company,
      status: c.status,
      score: 50, // Default score since we don't have lead_scores yet
      current_price: c.current_price,
      last_message: c.last_message,
      unread_count: parseInt(c.unread_count || 0),
      last_contacted_at: c.last_contacted_at,
      next_follow_up_at: c.next_follow_up_at,
    }));

    res.json({
      queue: enriched,
      total: enriched.length,
    });
  } catch (err) {
    console.error('Start day error:', err);
    res.json({ queue: [], total: 0 });
  }
});

// GET /api/dashboard/lead/:id - full lead profile
router.get('/lead/:id', async (req, res) => {
  try {
    const { rows: contact } = await db.query(`SELECT * FROM contacts WHERE id = $1`, [req.params.id]);
    if (!contact[0]) return res.status(404).json({ error: 'Not found' });

    const { rows: messages } = await db.query(
      `SELECT * FROM messages WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [req.params.id]
    ).catch(() => ({ rows: [] }));

    const { rows: offers } = await db.query(
      `SELECT * FROM offers WHERE contact_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    ).catch(() => ({ rows: [] }));

    res.json({
      lead: contact[0],
      messages,
      offers,
      score: { score: 50 },
    });
  } catch (err) {
    console.error('Lead detail error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/dashboard/lead/:id - update lead status/notes
router.patch('/lead/:id', async (req, res) => {
  try {
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
      `UPDATE contacts SET ${updates.join(', ')} WHERE id = $${paramNum} RETURNING *`,
      params
    );

    res.json(rows[0]);
  } catch (err) {
    console.error('Update lead error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

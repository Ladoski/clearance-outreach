const express = require('express');
const db = require('../lib/db');
const { requireAdmin } = require('../lib/auth');

const router = express.Router();
router.use(requireAdmin);

// GET /api/message-activity - all sent messages with status
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        fs.id,
        fs.contact_follow_up_id,
        fs.created_at,
        fs.channel,
        fm.message_text,
        fm.step_order,
        fm.hours_after_start,
        c.name,
        c.phone,
        c.status as contact_status,
        cfu.started_at,
        cfu.last_sent_step,
        cfu.completed_at,
        seq.name as sequence_name
      FROM follow_up_sends fs
      JOIN contact_follow_ups cfu ON cfu.id = fs.contact_follow_up_id
      JOIN follow_up_messages fm ON fm.id = fs.message_id
      JOIN contacts c ON c.id = cfu.contact_id
      JOIN follow_up_sequences seq ON seq.id = cfu.sequence_id
      ORDER BY fs.created_at DESC
      LIMIT 100
    `);
    
    res.json(rows || []);
  } catch (err) {
    console.error('Message activity error:', err);
    res.json([]);
  }
});

// GET /api/message-activity/contact/:id - messages for specific contact
router.get('/contact/:id', async (req, res) => {
  try {
    const { rows: contact } = await db.query(`SELECT * FROM contacts WHERE id = $1`, [req.params.id]);
    if (!contact[0]) return res.status(404).json({ error: 'Not found' });

    const { rows: followups } = await db.query(`
      SELECT 
        cfu.id,
        cfu.sequence_id,
        cfu.started_at,
        cfu.last_sent_step,
        cfu.completed_at,
        seq.name as sequence_name,
        seq.message_count
      FROM contact_follow_ups cfu
      JOIN follow_up_sequences seq ON seq.id = cfu.sequence_id
      WHERE cfu.contact_id = $1
      ORDER BY cfu.started_at DESC
    `, [req.params.id]);

    // For each follow-up, get sent messages and upcoming messages
    const details = [];
    for (const fu of followups) {
      const { rows: sent } = await db.query(`
        SELECT fs.created_at, fm.step_order, fm.message_text, fm.hours_after_start
        FROM follow_up_sends fs
        JOIN follow_up_messages fm ON fm.id = fs.message_id
        WHERE fs.contact_follow_up_id = $1
        ORDER BY fm.step_order
      `, [fu.id]);

      const { rows: upcoming } = await db.query(`
        SELECT step_order, message_text, hours_after_start
        FROM follow_up_messages
        WHERE sequence_id = $1 AND step_order > $2
        ORDER BY step_order
      `, [fu.sequence_id, fu.last_sent_step || 0]);

      details.push({
        sequence: fu.sequence_name,
        message_count: fu.message_count,
        started_at: fu.started_at,
        completed_at: fu.completed_at,
        progress: `${fu.last_sent_step || 0}/${fu.message_count}`,
        sent_messages: sent,
        upcoming_messages: upcoming
      });
    }

    res.json({
      contact: contact[0],
      sequences: details
    });
  } catch (err) {
    console.error('Contact activity error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/message-activity/pending-replies - messages awaiting response
router.get('/pending-replies', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        c.id,
        c.name,
        c.phone,
        c.status,
        cfu.sequence_id,
        seq.name as sequence_name,
        cfu.last_sent_step,
        (SELECT COUNT(*) FROM follow_up_messages WHERE sequence_id = seq.id) as total_steps,
        (SELECT created_at FROM follow_up_sends WHERE contact_follow_up_id = cfu.id ORDER BY created_at DESC LIMIT 1) as last_message_sent,
        (SELECT body FROM messages WHERE contact_id = c.id AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1) as last_reply,
        (SELECT created_at FROM messages WHERE contact_id = c.id AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1) as last_reply_time
      FROM contacts c
      JOIN contact_follow_ups cfu ON cfu.contact_id = c.id
      JOIN follow_up_sequences seq ON seq.id = cfu.sequence_id
      WHERE cfu.completed_at IS NULL
      AND c.status IN ('contacted', 'negotiating', 'replied')
      AND (SELECT COUNT(*) FROM messages WHERE contact_id = c.id AND direction = 'inbound' AND created_at > cfu.started_at) > 0
      ORDER BY last_reply_time DESC
    `);

    res.json(rows || []);
  } catch (err) {
    console.error('Pending replies error:', err);
    res.json([]);
  }
});

module.exports = router;

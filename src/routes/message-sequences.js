const express = require('express');
const db = require('../lib/db');
const { requireAdmin } = require('../lib/auth');

const router = express.Router();
router.use(requireAdmin);

// GET /api/follow-ups - list all defined sequences
router.get('/sequences', async (req, res) => {
  const { rows } = await db.query(
    `SELECT fs.*, COUNT(fm.id) AS message_count
     FROM follow_up_sequences fs
     LEFT JOIN follow_up_messages fm ON fm.sequence_id = fs.id
     GROUP BY fs.id
     ORDER BY fs.created_at DESC`,
    []
  );
  res.json(rows);
});

// POST /api/follow-ups/sequences - create a new sequence
router.post('/sequences', async (req, res) => {
  const { name, messages } = req.body;
  if (!name || !messages || !messages.length) {
    return res.status(400).json({ error: 'name and messages required' });
  }

  const { rows: seqRows } = await db.query(
    `INSERT INTO follow_up_sequences (name) VALUES ($1) RETURNING *`,
    [name]
  );
  const sequenceId = seqRows[0].id;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    await db.query(
      `INSERT INTO follow_up_messages (sequence_id, step_order, hours_after_start, message_text)
       VALUES ($1,$2,$3,$4)`,
      [sequenceId, i + 1, msg.hoursAfterStart, msg.text]
    );
  }

  res.json(seqRows[0]);
});

// GET /api/follow-ups/sequences/:id - get a sequence + all its messages
router.get('/sequences/:id', async (req, res) => {
  const { rows: seq } = await db.query(
    `SELECT * FROM follow_up_sequences WHERE id = $1`,
    [req.params.id]
  );
  if (!seq[0]) return res.status(404).json({ error: 'Not found' });

  const { rows: msgs } = await db.query(
    `SELECT * FROM follow_up_messages WHERE sequence_id = $1 ORDER BY step_order`,
    [req.params.id]
  );

  res.json({ ...seq[0], messages: msgs });
});

// POST /api/follow-ups/start - start a follow-up sequence for a contact
router.post('/start', async (req, res) => {
  const { contactId, sequenceId } = req.body;
  if (!contactId || !sequenceId) {
    return res.status(400).json({ error: 'contactId and sequenceId required' });
  }

  // Stop any existing active sequence for this contact
  await db.query(
    `UPDATE contact_follow_ups SET completed_at = now() WHERE contact_id = $1 AND completed_at IS NULL`,
    [contactId]
  );

  const { rows } = await db.query(
    `INSERT INTO contact_follow_ups (contact_id, sequence_id) VALUES ($1,$2) RETURNING *`,
    [contactId, sequenceId]
  );

  res.json(rows[0]);
});

// GET /api/follow-ups/contact/:contactId - get active follow-up + history for a contact
router.get('/contact/:contactId', async (req, res) => {
  const { rows: active } = await db.query(
    `SELECT cfu.*, fs.name AS sequence_name
     FROM contact_follow_ups cfu
     LEFT JOIN follow_up_sequences fs ON fs.id = cfu.sequence_id
     WHERE cfu.contact_id = $1 AND cfu.completed_at IS NULL
     LIMIT 1`,
    [req.params.contactId]
  );

  const { rows: history } = await db.query(
    `SELECT fs.name, fm.step_order, fm.message_text, fs_log.sent_at
     FROM follow_up_sends fs_log
     JOIN contact_follow_ups cfu ON cfu.id = fs_log.contact_follow_up_id
     JOIN follow_up_messages fm ON fm.id = fs_log.message_id
     JOIN follow_up_sequences fs ON fs.id = fm.sequence_id
     WHERE cfu.contact_id = $1
     ORDER BY fs_log.sent_at DESC
     LIMIT 20`,
    [req.params.contactId]
  );

  res.json({ active: active[0] || null, history });
});

// POST /api/follow-ups/:contactFollowUpId/send-now - manually trigger sending the next message
router.post('/:contactFollowUpId/send-now', async (req, res) => {
  const { rows: cfu } = await db.query(
    `SELECT * FROM contact_follow_ups WHERE id = $1`,
    [req.params.contactFollowUpId]
  );
  if (!cfu[0]) return res.status(404).json({ error: 'Not found' });

  // Get the next unsent message
  const { rows: nextMsg } = await db.query(
    `SELECT * FROM follow_up_messages
     WHERE sequence_id = $1 AND step_order > $2
     ORDER BY step_order LIMIT 1`,
    [cfu[0].sequence_id, cfu[0].last_sent_step || 0]
  );

  if (!nextMsg[0]) return res.status(400).json({ error: 'No more messages in sequence' });

  // Log the send
  const { rows: sent } = await db.query(
    `INSERT INTO follow_up_sends (contact_follow_up_id, message_id)
     VALUES ($1,$2) RETURNING *`,
    [req.params.contactFollowUpId, nextMsg[0].id]
  );

  // Update the contact_follow_ups to track which step was sent
  await db.query(
    `UPDATE contact_follow_ups SET last_sent_step = $1 WHERE id = $2`,
    [nextMsg[0].step_order, req.params.contactFollowUpId]
  );

  res.json({ message: nextMsg[0], sent: sent[0] });
});

// POST /api/follow-ups/:contactFollowUpId/stop - stop the sequence
router.post('/:contactFollowUpId/stop', async (req, res) => {
  const { rows } = await db.query(
    `UPDATE contact_follow_ups SET completed_at = now() WHERE id = $1 RETURNING *`,
    [req.params.contactFollowUpId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

module.exports = router;

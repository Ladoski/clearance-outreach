const express = require('express');
const db = require('../lib/db');
const { requireAdmin } = require('../lib/auth');

const router = express.Router();
router.use(requireAdmin);

// GET /api/call-bank - list all banked (model) calls with their notes
router.get('/', async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.*, cbn.bank_reason, cbn.text_option_1, cbn.text_option_2, cbn.text_option_3,
            cont.name AS contact_name, cont.phone AS contact_phone,
            cs.overall_score
     FROM calls c
     LEFT JOIN call_bank_notes cbn ON cbn.call_id = c.id
     LEFT JOIN contacts cont ON cont.id = c.contact_id
     LEFT JOIN LATERAL (
       SELECT overall_score FROM call_scores WHERE call_scores.call_id = c.id
       ORDER BY created_at DESC LIMIT 1
     ) cs ON true
     WHERE c.is_model_call = true
     ORDER BY c.start_time DESC`,
    []
  );
  res.json(rows);
});

// POST /api/call-bank/:callId - add a call to the call bank (mark as model_call)
router.post('/:callId', async (req, res) => {
  const { bank_reason, text_option_1, text_option_2, text_option_3 } = req.body;

  // Mark the call as a model call
  await db.query(`UPDATE calls SET is_model_call = true WHERE id = $1`, [req.params.callId]);

  // Add or update bank notes
  const existing = await db.query(`SELECT id FROM call_bank_notes WHERE call_id = $1`, [req.params.callId]);
  if (existing.rows[0]) {
    await db.query(
      `UPDATE call_bank_notes SET bank_reason = $1, text_option_1 = $2, text_option_2 = $3,
                                   text_option_3 = $4, updated_at = now() WHERE call_id = $5`,
      [bank_reason, text_option_1, text_option_2, text_option_3, req.params.callId]
    );
  } else {
    await db.query(
      `INSERT INTO call_bank_notes (call_id, bank_reason, text_option_1, text_option_2, text_option_3)
       VALUES ($1,$2,$3,$4,$5)`,
      [req.params.callId, bank_reason, text_option_1, text_option_2, text_option_3]
    );
  }

  const { rows } = await db.query(`SELECT * FROM calls WHERE id = $1`, [req.params.callId]);
  res.json(rows[0]);
});

// DELETE /api/call-bank/:callId - remove from call bank
router.delete('/:callId', async (req, res) => {
  await db.query(`UPDATE calls SET is_model_call = false WHERE id = $1`, [req.params.callId]);
  await db.query(`DELETE FROM call_bank_notes WHERE call_id = $1`, [req.params.callId]);
  const { rows } = await db.query(`SELECT * FROM calls WHERE id = $1`, [req.params.callId]);
  res.json(rows[0]);
});

module.exports = router;

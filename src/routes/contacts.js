const express = require('express');
const db = require('../lib/db');
const { requireAdmin } = require('../lib/auth');

const router = express.Router();
router.use(requireAdmin);

/** GET /api/contacts?status=&temperature= */
router.get('/', async (req, res) => {
  const { status, temperature } = req.query;
  const clauses = [];
  const params = [];
  if (status) { params.push(status); clauses.push(`status = $${params.length}`); }
  if (temperature) { params.push(temperature); clauses.push(`temperature = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT * FROM contacts ${where} ORDER BY next_follow_up_at ASC NULLS LAST, updated_at DESC`,
    params
  );
  res.json(rows);
});

/** POST /api/contacts - manual add */
router.post('/', async (req, res) => {
  const { name, phone, email, company, notes, temperature } = req.body;
  if (!phone && !email) return res.status(400).json({ error: 'phone or email required' });
  const { rows } = await db.query(
    `INSERT INTO contacts (name, phone, email, company, notes, temperature)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [name, phone, email, company, notes, temperature || 'warm']
  );
  res.status(201).json(rows[0]);
});

/** GET /api/contacts/:id - detail with call history */
router.get('/:id', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM contacts WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  const calls = await db.query(
    `SELECT calls.*, cs.overall_score, cs.coaching_priority FROM calls
     LEFT JOIN LATERAL (
       SELECT overall_score, coaching_priority FROM call_scores
       WHERE call_scores.call_id = calls.id ORDER BY created_at DESC LIMIT 1
     ) cs ON true
     WHERE calls.contact_id = $1 ORDER BY start_time DESC`,
    [req.params.id]
  );
  res.json({ ...rows[0], calls: calls.rows });
});

/** PATCH /api/contacts/:id - update status/temperature/notes/next_follow_up_at */
router.patch('/:id', async (req, res) => {
  const allowed = ['name', 'email', 'company', 'status', 'temperature', 'notes', 'next_follow_up_at'];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      params.push(req.body[key]);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'No updatable fields provided' });
  params.push(req.params.id);
  const { rows } = await db.query(
    `UPDATE contacts SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
    params
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

module.exports = router;

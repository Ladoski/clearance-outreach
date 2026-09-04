const express = require('express');
const multer = require('multer');
const db = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { parseCsvLeads, parsePdfLeads } = require('../lib/leadImport');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(requireAdmin);

/**
 * POST /api/leads/import?building_id=1
 * multipart/form-data with field "file" — CSV or PDF
 */
router.post('/import', upload.single('file'), async (req, res) => {
  const buildingId = req.query.building_id;
  if (!buildingId) return res.status(400).json({ error: 'building_id query param is required' });
  if (!req.file) return res.status(400).json({ error: 'file is required (field name "file")' });

  const building = await db.query('SELECT * FROM buildings WHERE id = $1', [buildingId]);
  if (!building.rows[0]) return res.status(404).json({ error: 'building_id not found' });

  let rows;
  try {
    if (req.file.mimetype === 'application/pdf' || req.file.originalname.toLowerCase().endsWith('.pdf')) {
      rows = await parsePdfLeads(req.file.buffer);
    } else {
      rows = parseCsvLeads(req.file.buffer);
    }
  } catch (err) {
    return res.status(400).json({ error: `Failed to parse file: ${err.message}` });
  }

  if (rows.length === 0) {
    return res.status(400).json({ error: 'No valid leads found (need at least phone or email per row)' });
  }

  const inserted = [];
  for (const r of rows) {
    const { rows: result } = await db.query(
      `INSERT INTO leads (building_id, name, phone, email, company, notes, preferred_channel, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'new') RETURNING *`,
      [buildingId, r.name, r.phone, r.email, r.company, r.notes, r.preferred_channel]
    );
    inserted.push(result[0]);
  }

  res.status(201).json({ imported: inserted.length, leads: inserted });
});

// List leads, optionally filtered by status / building
router.get('/', async (req, res) => {
  const { status, building_id } = req.query;
  const clauses = [];
  const params = [];
  if (status) {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }
  if (building_id) {
    params.push(building_id);
    clauses.push(`building_id = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT * FROM leads ${where} ORDER BY day_count DESC, created_at ASC`,
    params
  );
  res.json(rows);
});

/**
 * GET /api/leads/grouped
 * Groups leads by day_count (i.e. which round of the "auction" they're on)
 * and includes their current asking price — matches the "classify by day /
 * potential offer price" requirement.
 */
router.get('/grouped', async (req, res) => {
  const { rows } = await db.query(
    `SELECT day_count, status, count(*)::int AS lead_count,
            json_agg(json_build_object(
              'id', id, 'name', name, 'phone', phone, 'email', email,
              'current_price', current_price, 'status', status,
              'last_contacted_at', last_contacted_at, 'next_follow_up_at', next_follow_up_at
            ) ORDER BY current_price ASC) AS leads
     FROM leads
     GROUP BY day_count, status
     ORDER BY day_count ASC, status ASC`
  );
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM leads WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  const messages = await db.query(
    'SELECT * FROM messages WHERE lead_id = $1 ORDER BY created_at ASC',
    [req.params.id]
  );
  res.json({ ...rows[0], messages: messages.rows });
});

// Manually update a lead (e.g. mark cold, adjust agreed price, change status)
router.patch('/:id', async (req, res) => {
  const allowed = ['status', 'agreed_price', 'notes', 'preferred_channel', 'current_price'];
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
    `UPDATE leads SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
    params
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

module.exports = router;

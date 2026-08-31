const express = require('express');
const db = require('../lib/db');
const { requireAdmin } = require('../lib/auth');

const router = express.Router();
router.use(requireAdmin);

// Create a clearance building record
router.post('/', async (req, res) => {
  const { name, address, details, initial_price, floor_price } = req.body;
  if (!name || !initial_price) {
    return res.status(400).json({ error: 'name and initial_price are required' });
  }
  const { rows } = await db.query(
    `INSERT INTO buildings (name, address, details, initial_price, floor_price)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name, address || null, details || null, initial_price, floor_price || null]
  );
  res.status(201).json(rows[0]);
});

router.get('/', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM buildings ORDER BY created_at DESC');
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM buildings WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

module.exports = router;

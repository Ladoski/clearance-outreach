const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../lib/db');
const { requireAdmin } = require('../lib/auth');

const router = express.Router();
router.use(requireAdmin);

/**
 * POST /api/admin/migrate
 * Applies migrations/schema.sql. Safe to call more than once — every
 * statement uses IF NOT EXISTS. This exists so free-tier Render users
 * (no Shell access) can set up the database without a terminal.
 */
router.post('/migrate', async (req, res) => {
  try {
    const sql = fs.readFileSync(
      path.join(__dirname, '..', '..', 'migrations', 'schema.sql'),
      'utf8'
    );
    await db.query(sql);
    res.json({ ok: true, message: 'Schema applied successfully.' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;

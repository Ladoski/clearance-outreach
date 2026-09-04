const express = require('express');
const db = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { runCallSync } = require('../lib/callPipeline');
const { analyzeTranscript } = require('../lib/callAnalysis');

const router = express.Router();
router.use(requireAdmin);

/** POST /api/calls/sync - re-scans the lookback window, processes a batch that needs work */
router.post('/sync', async (req, res) => {
  const summary = await runCallSync();
  res.json(summary);
});

/** GET /api/calls?status=done&contact_id=5 - list, newest first, with latest score */
router.get('/', async (req, res) => {
  const { contact_id } = req.query;
  const params = [];
  let where = '';
  if (contact_id) {
    params.push(contact_id);
    where = `WHERE calls.contact_id = $${params.length}`;
  }
  const { rows } = await db.query(
    `SELECT calls.*, contacts.name AS contact_name, contacts.phone AS contact_phone,
            cs.overall_score, cs.coaching_priority
     FROM calls
     LEFT JOIN contacts ON contacts.id = calls.contact_id
     LEFT JOIN LATERAL (
       SELECT overall_score, coaching_priority FROM call_scores
       WHERE call_scores.call_id = calls.id ORDER BY created_at DESC LIMIT 1
     ) cs ON true
     ${where}
     ORDER BY calls.start_time DESC
     LIMIT 200`,
    params
  );
  res.json(rows);
});

/** GET /api/calls/:id - full detail incl. transcript + full scorecard */
router.get('/:id', async (req, res) => {
  const { rows } = await db.query(
    `SELECT calls.*, contacts.name AS contact_name, contacts.phone AS contact_phone
     FROM calls LEFT JOIN contacts ON contacts.id = calls.contact_id
     WHERE calls.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });

  const scoreRes = await db.query(
    'SELECT * FROM call_scores WHERE call_id = $1 ORDER BY created_at DESC LIMIT 1',
    [req.params.id]
  );

  res.json({ ...rows[0], score: scoreRes.rows[0] || null });
});

/** POST /api/calls/:id/analyze - re-run transcription+scoring for one call */
router.post('/:id/analyze', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM calls WHERE id = $1', [req.params.id]);
  const call = rows[0];
  if (!call) return res.status(404).json({ error: 'Not found' });
  if (!call.recording_id) return res.status(400).json({ error: 'This call has no recording' });

  // recording_id alone isn't enough to redownload; require a fresh sync's contentUri.
  // For a manual re-analyze when we already have a transcript, just re-score it.
  if (call.transcript) {
    try {
      const scorecard = await analyzeTranscript(call.transcript);
      await db.query(
        `INSERT INTO call_scores (call_id, overall_score, categories, strengths, weaknesses,
                                   missed_opportunities, customer_signals, coaching_priority,
                                   next_call_recommendation)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          call.id, scorecard.overall_score, JSON.stringify(scorecard.categories),
          JSON.stringify(scorecard.strengths), JSON.stringify(scorecard.weaknesses),
          JSON.stringify(scorecard.missed_opportunities), JSON.stringify(scorecard.customer_signals),
          scorecard.coaching_priority, scorecard.next_call_recommendation,
        ]
      );
      return res.json({ ok: true, score: scorecard.overall_score });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({
    error: 'No transcript yet for this call. Run POST /api/calls/sync again to reprocess.',
  });
});

module.exports = router;

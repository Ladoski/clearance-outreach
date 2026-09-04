const express = require('express');
const db = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { getFollowUpBuckets } = require('../lib/followUps');

const router = express.Router();
router.use(requireAdmin);

/** GET /api/followups - overdue / today / tomorrow / waiting_for_response / hot_leads */
router.get('/', async (req, res) => {
  const buckets = await getFollowUpBuckets();
  res.json(buckets);
});

/** POST /api/followups/:contactId/snooze  { hours: 24 }  (or "days") */
router.post('/:contactId/snooze', async (req, res) => {
  const hours = Number(req.body.hours || (req.body.days ? req.body.days * 24 : 24));
  const nextFollowUp = new Date(Date.now() + hours * 3600 * 1000);
  const { rows } = await db.query(
    `UPDATE contacts SET next_follow_up_at = $1,
                          status = 'follow_up', updated_at = now()
     WHERE id = $2 RETURNING *`,
    [nextFollowUp, req.params.contactId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

/** POST /api/followups/:contactId/complete - mark as handled, clears the due date */
router.post('/:contactId/complete', async (req, res) => {
  const { rows } = await db.query(
    `UPDATE contacts SET next_follow_up_at = NULL, last_contact_at = now(), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [req.params.contactId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

module.exports = router;

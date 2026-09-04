const express = require('express');
const db = require('../lib/db');
const { requireCronSecret } = require('../lib/auth');
const { runDailyFollowUps } = require('../lib/dailyJob');
const { runCallSync } = require('../lib/callPipeline');

const router = express.Router();

// POST /api/cron/daily-follow-up  (header x-cron-secret required)
router.post('/daily-follow-up', requireCronSecret, async (req, res) => {
  const summary = await runDailyFollowUps();
  res.json(summary);
});

// POST /api/cron/sync-calls  (header x-cron-secret required)
// Pulls new RingCentral calls from the last hour, transcribes + scores any with a recording.
router.post('/sync-calls', requireCronSecret, async (req, res) => {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const summary = await runCallSync(since);
  res.json(summary);
});

module.exports = router;

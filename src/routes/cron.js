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
// Re-scans the lookback window, transcribes + scores a batch of calls that need it.
router.post('/sync-calls', requireCronSecret, async (req, res) => {
  const summary = await runCallSync();
  res.json(summary);
});

// POST /api/cron/send-sequences  (header x-cron-secret required)
// Checks all active contact follow-up sequences and sends any messages that are due.
router.post('/send-sequences', requireCronSecret, async (req, res) => {
  const { sendSequenceMessages } = require('../lib/messageSequences');
  const summary = await sendSequenceMessages();
  res.json(summary);
});

module.exports = router;

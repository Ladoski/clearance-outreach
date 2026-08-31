const express = require('express');
const db = require('../lib/db');
const { requireCronSecret } = require('../lib/auth');
const { runDailyFollowUps } = require('../lib/dailyJob');

const router = express.Router();

// POST /api/cron/daily-follow-up  (header x-cron-secret required)
router.post('/daily-follow-up', requireCronSecret, async (req, res) => {
  const summary = await runDailyFollowUps();
  res.json(summary);
});

module.exports = router;

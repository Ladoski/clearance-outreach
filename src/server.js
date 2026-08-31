const express = require('express');
const path = require('path');
const cron = require('node-cron');
const adminRoutes = require('./routes/admin');
app.use('/api/cron', cronRoutes);
app.use('/api/admin', adminRoutes);
const config = require('./config');
const { runDailyFollowUps } = require('./lib/dailyJob');

const buildingsRoutes = require('./routes/buildings');
const leadsRoutes = require('./routes/leads');
const outreachRoutes = require('./routes/outreach');
const offersRoutes = require('./routes/offers');
const webhooksRoutes = require('./routes/webhooks');
const cronRoutes = require('./routes/cron');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/buildings', buildingsRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/outreach', outreachRoutes);
app.use('/api/offers', offersRoutes);
app.use('/webhooks', webhooksRoutes);
app.use('/api/cron', cronRoutes);

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] Listening on port ${config.port}`);
});

/**
 * OPTIONAL: run the daily job in-process on a schedule instead of (or in
 * addition to) using a Render Cron Job hitting /api/cron/daily-follow-up.
 * Only useful if this service stays awake 24/7 (i.e. not a free-tier
 * service that spins down). Disabled by default — set ENABLE_INTERNAL_CRON=true.
 */
if ((process.env.ENABLE_INTERNAL_CRON || 'false').toLowerCase() === 'true') {
  const hour = config.followUp.dailySendHour;
  cron.schedule(`0 ${hour} * * *`, async () => {
    // eslint-disable-next-line no-console
    console.log('[cron] Running daily follow-up job...');
    const summary = await runDailyFollowUps();
    // eslint-disable-next-line no-console
    console.log('[cron] Done:', summary);
  });
}

module.exports = app;

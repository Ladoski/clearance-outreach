const config = require('../config');

/** Requires header: x-api-key: <ADMIN_API_KEY> */
function requireAdmin(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== config.adminApiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/** Requires header: x-cron-secret: <CRON_SECRET> — used by Render Cron Job */
function requireCronSecret(req, res, next) {
  const secret = req.headers['x-cron-secret'];
  if (secret !== config.cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = { requireAdmin, requireCronSecret };

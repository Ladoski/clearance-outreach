/**
 * Run once after deploying (and whenever the subscription expires):
 *   node scripts/subscribe.js
 * Registers a webhook so inbound SMS replies hit /webhooks/ringcentral.
 * Subscriptions expire (see expiresIn in src/lib/ringcentral.js) — for
 * production, re-run this on a schedule (e.g. a weekly Render Cron Job).
 */
require('dotenv').config();
const { createInboundSubscription } = require('../src/lib/ringcentral');

createInboundSubscription()
  .then((sub) => {
    console.log('Subscription created:', JSON.stringify(sub, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error('Failed to create subscription:', err);
    process.exit(1);
  });

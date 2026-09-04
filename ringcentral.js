const { SDK } = require('@ringcentral/sdk');
const config = require('../config');

let rcsdk;
let platform;

function getPlatform() {
  if (platform) return platform;

  rcsdk = new SDK({
    server: config.ringcentral.server,
    clientId: config.ringcentral.clientId,
    clientSecret: config.ringcentral.clientSecret,
  });
  platform = rcsdk.platform();
  return platform;
}

async function ensureLoggedIn() {
  const p = getPlatform();
  const loggedIn = await p.loggedIn().catch(() => false);
  if (!loggedIn) {
    // JWT auth is recommended for server-to-server apps (no password to store)
    await p.login({ jwt: config.ringcentral.jwt });
  }
  return p;
}

/**
 * Sends a single SMS via RingCentral.
 * @param {string} toNumber - E.164 format, e.g. +15551234567
 * @param {string} text
 * @returns {Promise<{id: string, raw: object}>}
 */
async function sendSms(toNumber, text) {
  const p = await ensureLoggedIn();
  const resp = await p.post('/restapi/v1.0/account/~/extension/~/sms', {
    from: { phoneNumber: config.ringcentral.fromNumber },
    to: [{ phoneNumber: toNumber }],
    text,
  });
  const json = await resp.json();
  return { id: String(json.id), raw: json };
}

/**
 * Creates a webhook subscription so inbound SMS replies hit
 * config.ringcentral.publicWebhookUrl (POST /webhooks/ringcentral).
 * Run this once after deploying (see scripts/subscribe.js).
 */
async function createInboundSubscription() {
  const p = await ensureLoggedIn();
  const resp = await p.post('/restapi/v1.0/subscription', {
    eventFilters: ['/restapi/v1.0/account/~/extension/~/message-store/instant?type=SMS'],
    deliveryMode: {
      transportType: 'WebHook',
      address: config.ringcentral.publicWebhookUrl,
    },
    expiresIn: 604800, // 7 days; re-subscribe periodically (see scripts/subscribe.js + cron)
  });
  return resp.json();
}

module.exports = { sendSms, createInboundSubscription, getPlatform };

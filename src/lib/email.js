const nodemailer = require('nodemailer');
const config = require('../config');

let transporter;

function getTransporter() {
  if (transporter) return transporter;
  if (!config.email.enabled) return null;

  transporter = nodemailer.createTransport({
    host: config.email.smtpHost,
    port: config.email.smtpPort,
    secure: config.email.smtpPort === 465,
    auth: {
      user: config.email.smtpUser,
      pass: config.email.smtpPass,
    },
  });
  return transporter;
}

/**
 * Sends an email using the same shape as the SMS adapter, so the
 * outreach/cron code can treat both channels identically.
 * @param {string} toAddress
 * @param {{subject: string, text: string}} content
 * @returns {Promise<{id: string, raw: object}>}
 */
async function sendEmail(toAddress, content) {
  const t = getTransporter();
  if (!t) {
    throw new Error('Email channel is disabled. Set EMAIL_ENABLED=true and SMTP_* vars in .env');
  }
  const info = await t.sendMail({
    from: `"${config.email.fromName}" <${config.email.fromAddress}>`,
    to: toAddress,
    subject: content.subject,
    text: content.text,
  });
  return { id: info.messageId, raw: info };
}

module.exports = { sendEmail };

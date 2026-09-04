require('dotenv').config();

/**
 * All tunables live here so the pricing/cadence logic can be changed
 * later (per the "decide later" plan) without touching business logic.
 */
module.exports = {
  port: process.env.PORT || 3000,

  // --- Database ---
  databaseUrl: process.env.DATABASE_URL, // Render Postgres connection string

  // --- Security ---
  cronSecret: process.env.CRON_SECRET || 'change-me-cron-secret',
  adminApiKey: process.env.ADMIN_API_KEY || 'change-me-admin-key',
  webhookVerificationToken: process.env.RC_WEBHOOK_TOKEN || '',
  emailWebhookSecret: process.env.EMAIL_WEBHOOK_SECRET || 'change-me-email-secret',

  // --- RingCentral (SMS channel) ---
  ringcentral: {
    server: process.env.RC_SERVER || 'https://platform.ringcentral.com',
    clientId: process.env.RC_CLIENT_ID,
    clientSecret: process.env.RC_CLIENT_SECRET,
    jwt: process.env.RC_JWT, // JWT auth (recommended over username/password)
    fromNumber: process.env.RC_FROM_NUMBER, // your RingCentral SMS-enabled number
    publicWebhookUrl: process.env.RC_WEBHOOK_URL, // e.g. https://yourapp.onrender.com/webhooks/ringcentral
  },

  // --- Email (parallel channel, same framework) ---
  email: {
    enabled: (process.env.EMAIL_ENABLED || 'false').toLowerCase() === 'true',
    smtpHost: process.env.SMTP_HOST,
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtpUser: process.env.SMTP_USER,
    smtpPass: process.env.SMTP_PASS,
    fromAddress: process.env.EMAIL_FROM || 'offers@yourcompany.com',
    fromName: process.env.EMAIL_FROM_NAME || 'Your Company Clearance Team',
  },

  // --- Company / building details injected into templates ---
  company: {
    name: process.env.COMPANY_NAME || 'Your Company',
    phone: process.env.COMPANY_PHONE || '(555) 555-5555',
    license: process.env.COMPANY_LICENSE || '',
  },

  // --- Pricing engine defaults (placeholder until you finalize the model) ---
  pricing: {
    // 'percent' | 'fixed' | 'manual'
    strategy: process.env.PRICING_STRATEGY || 'percent',
    percentPerDay: Number(process.env.PRICING_PERCENT_PER_DAY || 5), // 5% off per day
    fixedPerDay: Number(process.env.PRICING_FIXED_PER_DAY || 500), // $500 off per day
    floorPercentOfAsk: Number(process.env.PRICING_FLOOR_PERCENT || 50), // stop at 50% of initial ask by default
  },

  // --- Follow-up cadence (price-negotiation leads) ---
  followUp: {
    // How many hours must pass with no reply before the next auto follow-up fires
    hoursBetweenFollowUps: Number(process.env.FOLLOWUP_HOURS || 24),
    // Local hour (0-23, server time) the daily cron is intended to run at.
    // Actual trigger is Render Cron Job / node-cron; this is just documentation/metadata.
    dailySendHour: Number(process.env.FOLLOWUP_HOUR || 9),
  },

  // --- Call coaching + follow-up system ---
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
  },
  assemblyai: {
    apiKey: process.env.ASSEMBLYAI_API_KEY,
  },
  callFollowUp: {
    // A phone contact with no reply after this many hours becomes "overdue"
    hoursUntilOverdue: Number(process.env.CALL_FOLLOWUP_HOURS || 48),
  },
};

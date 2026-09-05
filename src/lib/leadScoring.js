const db = require('./db');

/**
 * Compute lead score (0-100)
 * Factors: engagement, inquiry recency, match quality, conversion signals
 */
async function computeLeadScore(leadId) {
  const { rows: lead } = await db.query(`SELECT * FROM leads WHERE id = $1`, [leadId]);
  if (!lead[0]) return 0;

  let score = 50; // Base score

  // Engagement signals (+10 each)
  if (lead[0].status === 'replied') score += 20;
  if (lead[0].status === 'negotiating') score += 25;
  if (lead[0].agreed_price) score += 15;

  // Message history
  const { rows: messages } = await db.query(
    `SELECT * FROM messages WHERE lead_id = $1 AND direction = 'inbound' ORDER BY created_at DESC LIMIT 5`,
    [leadId]
  );
  
  score += Math.min(messages.length * 5, 20); // +5 per inbound, max 20

  // Recent activity boost
  const lastContact = new Date(lead[0].last_contacted_at);
  const daysSince = (Date.now() - lastContact.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince < 3) score += 15;
  else if (daysSince < 7) score += 10;
  else if (daysSince > 30) score -= 10;

  // Open offers
  const { rows: offers } = await db.query(
    `SELECT * FROM offers WHERE lead_id = $1 AND status = 'pending_approval'`,
    [leadId]
  );
  if (offers.length > 0) score += 20;

  // Price engagement (asked about pricing = hot signal)
  const priceMessages = messages.filter(m => 
    m.body.toLowerCase().includes('price') || 
    m.body.toLowerCase().includes('cost') ||
    m.body.toLowerCase().includes('how much')
  );
  if (priceMessages.length > 0) score += 15;

  // Negative signals
  if (lead[0].status === 'cold' || lead[0].status === 'dead') score = Math.min(score, 20);
  if (lead[0].status === 'new' && daysSince > 60) score -= 5;

  // Cap at 0-100
  score = Math.max(0, Math.min(100, score));

  // Save score
  await db.query(
    `INSERT INTO lead_scores (lead_id, score, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (lead_id) DO UPDATE SET score = $2, updated_at = now()`,
    [leadId, score]
  );

  return score;
}

/**
 * Get all leads with scores, grouped by priority
 */
async function getLeadsByPriority() {
  const { rows: leads } = await db.query(`
    SELECT l.*, 
           ls.score,
           (SELECT COUNT(*) FROM messages WHERE lead_id = l.id AND direction = 'inbound') as unread_count,
           (SELECT body FROM messages WHERE lead_id = l.id ORDER BY created_at DESC LIMIT 1) as last_message
    FROM leads l
    LEFT JOIN lead_scores ls ON ls.lead_id = l.id
    WHERE l.status NOT IN ('dead', 'cold')
    ORDER BY 
      CASE WHEN l.status = 'negotiating' THEN 1
           WHEN l.status = 'replied' THEN 2
           WHEN ls.score >= 80 THEN 3
           WHEN ls.score >= 50 THEN 4
           ELSE 5
      END,
      ls.score DESC,
      l.last_contacted_at DESC NULLS LAST
    LIMIT 50
  `);

  return leads;
}

/**
 * Score all leads (batch)
 */
async function scoreAllLeads() {
  const { rows: leads } = await db.query(`SELECT id FROM leads WHERE status NOT IN ('dead', 'cold')`);
  let scored = 0;
  for (const lead of leads) {
    await computeLeadScore(lead.id);
    scored++;
  }
  return scored;
}

module.exports = { computeLeadScore, getLeadsByPriority, scoreAllLeads };

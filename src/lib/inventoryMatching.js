const db = require('./db');

/**
 * Find leads that match a building
 * Match on: size (±10%), model, location
 */
async function findMatchingLeads(buildingId) {
  const { rows: bldg } = await db.query(`SELECT * FROM buildings WHERE id = $1`, [buildingId]);
  if (!bldg[0]) return [];

  const w = bldg[0].width_ft;
  const l = bldg[0].length_ft;

  // Find leads with similar inquiries
  const { rows: leads } = await db.query(`
    SELECT l.*, ls.score FROM leads l
    LEFT JOIN lead_scores ls ON ls.lead_id = l.id
    WHERE l.status NOT IN ('dead', 'cold', 'won')
    AND (
      -- Exact or near match
      (ABS(COALESCE(l.inquiry_width_ft, 0) - $1) <= 5 AND 
       ABS(COALESCE(l.inquiry_length_ft, 0) - $2) <= 5)
      OR
      -- Size range match (±10%)
      (l.inquiry_width_ft BETWEEN $1 * 0.9 AND $1 * 1.1 AND
       l.inquiry_length_ft BETWEEN $2 * 0.9 AND $2 * 1.1)
      OR
      -- Model match
      (l.inquiry_model IS NOT NULL AND l.inquiry_model = $3)
      OR
      -- Location match
      (l.location = $4)
    )
    ORDER BY 
      CASE WHEN ls.score >= 80 THEN 1
           WHEN ls.score >= 50 THEN 2
           ELSE 3
      END,
      ls.score DESC
    LIMIT 200
  `, [w, l, bldg[0].model, bldg[0].location]);

  return leads;
}

/**
 * When viewing a building, show match stats
 */
async function getMatchStats(buildingId) {
  const matches = await findMatchingLeads(buildingId);
  
  const hot = matches.filter(m => m.score >= 80).length;
  const warm = matches.filter(m => m.score >= 50 && m.score < 80).length;
  const cold = matches.filter(m => m.score < 50).length;

  return { total: matches.length, hot, warm, cold, matches };
}

module.exports = { findMatchingLeads, getMatchStats };

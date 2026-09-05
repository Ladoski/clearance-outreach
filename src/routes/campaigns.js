const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const db = require('../lib/db');
const { requireAdmin } = require('../lib/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
router.use(requireAdmin);

// GET /api/campaigns - list all campaigns
router.get('/', async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.*, fs.name AS sequence_name,
            (SELECT COUNT(*) FROM campaign_leads WHERE campaign_id = c.id) AS total_leads,
            (SELECT COUNT(*) FROM campaign_leads WHERE campaign_id = c.id AND completed_at IS NOT NULL) AS completed_leads
     FROM campaigns c
     LEFT JOIN follow_up_sequences fs ON fs.id = c.sequence_id
     ORDER BY c.created_at DESC`,
    []
  );
  res.json(rows);
});

// POST /api/campaigns - create a new campaign
router.post('/', async (req, res) => {
  const { name, region, sequenceId, description } = req.body;
  if (!name || !region || !sequenceId) {
    return res.status(400).json({ error: 'name, region, and sequenceId required' });
  }

  const { rows } = await db.query(
    `INSERT INTO campaigns (name, region, sequence_id, description) VALUES ($1,$2,$3,$4) RETURNING *`,
    [name, region, sequenceId, description || null]
  );
  res.json(rows[0]);
});

// POST /api/campaigns/:campaignId/upload-leads - bulk import CSV
router.post('/:campaignId/upload-leads', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const records = parse(req.file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    const { rows: campaign } = await db.query(
      `SELECT * FROM campaigns WHERE id = $1`,
      [req.params.campaignId]
    );
    if (!campaign[0]) return res.status(404).json({ error: 'Campaign not found' });

    let created = 0;
    let enrolled = 0;

    for (const record of records) {
      const { name, phone, email } = record;
      if (!name || (!phone && !email)) continue;

      // Upsert contact
      const { rows: contacts } = await db.query(
        `INSERT INTO contacts (name, phone, email, status, temperature)
         VALUES ($1,$2,$3,'new','warm')
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [name, phone || null, email || null]
      );

      let contactId;
      if (contacts[0]) {
        contactId = contacts[0].id;
        created += 1;
      } else {
        // Contact already exists, find it
        const { rows: existing } = await db.query(
          `SELECT id FROM contacts WHERE (phone = $1 OR email = $2) LIMIT 1`,
          [phone || null, email || null]
        );
        if (existing[0]) contactId = existing[0].id;
      }

      if (contactId) {
        // Enroll in campaign
        await db.query(
          `INSERT INTO campaign_leads (campaign_id, contact_id)
           VALUES ($1,$2)
           ON CONFLICT DO NOTHING`,
          [req.params.campaignId, contactId]
        );
        enrolled += 1;
      }
    }

    res.json({ created, enrolled, total: records.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/campaigns/:campaignId/progress - campaign metrics
router.get('/:campaignId/progress', async (req, res) => {
  const { rows: campaign } = await db.query(
    `SELECT c.*, fs.name AS sequence_name
     FROM campaigns c
     LEFT JOIN follow_up_sequences fs ON fs.id = c.sequence_id
     WHERE c.id = $1`,
    [req.params.campaignId]
  );
  if (!campaign[0]) return res.status(404).json({ error: 'Not found' });

  const { rows: leads } = await db.query(
    `SELECT cl.*, c.name, c.phone, cfu.last_sent_step
     FROM campaign_leads cl
     JOIN contacts c ON c.id = cl.contact_id
     LEFT JOIN contact_follow_ups cfu ON cfu.id = cl.contact_follow_up_id
     WHERE cl.campaign_id = $1
     ORDER BY cl.enrolled_at DESC`,
    [req.params.campaignId]
  );

  const totalLeads = leads.length;
  const enrolledInSequence = leads.filter((l) => l.contact_follow_up_id).length;
  const completedSequence = leads.filter((l) => l.completed_at).length;

  res.json({
    campaign: campaign[0],
    stats: { totalLeads, enrolledInSequence, completedSequence },
    leads,
  });
});

// POST /api/campaigns/:campaignId/start-all - start the sequence for all enrolled leads
router.post('/:campaignId/start-all', async (req, res) => {
  const { rows: campaign } = await db.query(
    `SELECT * FROM campaigns WHERE id = $1`,
    [req.params.campaignId]
  );
  if (!campaign[0]) return res.status(404).json({ error: 'Not found' });

  // Get all unenrolled leads in this campaign
  const { rows: unenrolledLeads } = await db.query(
    `SELECT cl.contact_id FROM campaign_leads cl
     WHERE cl.campaign_id = $1 AND cl.contact_follow_up_id IS NULL`,
    [req.params.campaignId]
  );

  let started = 0;
  for (const lead of unenrolledLeads) {
    try {
      const { rows: cfu } = await db.query(
        `INSERT INTO contact_follow_ups (contact_id, sequence_id) VALUES ($1,$2) RETURNING *`,
        [lead.contact_id, campaign[0].sequence_id]
      );

      await db.query(
        `UPDATE campaign_leads SET contact_follow_up_id = $1 WHERE campaign_id = $2 AND contact_id = $3`,
        [cfu[0].id, req.params.campaignId, lead.contact_id]
      );

      started += 1;
    } catch (err) {
      console.error(`Failed to start sequence for lead ${lead.contact_id}:`, err.message);
    }
  }

  res.json({ started, total: unenrolledLeads.length });
});

// POST /api/campaigns/:campaignId/pause - pause a campaign
router.post('/:campaignId/pause', async (req, res) => {
  const { rows } = await db.query(
    `UPDATE campaigns SET status = 'paused', updated_at = now() WHERE id = $1 RETURNING *`,
    [req.params.campaignId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

module.exports = router;

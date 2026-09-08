const db = require('./db');
const { sendSms } = require('./channels');

/**
 * Sends all follow-up messages that are due right now.
 * Runs via cron (hourly), finds all active sequences where the next message
 * is due based on elapsed time since started_at.
 */
async function sendSequenceMessages() {
  const now = new Date();
  let sent = 0;
  let errors = 0;
  const failedLeads = [];

  try {
    // Find all active follow-ups
    const { rows: activeFollowUps } = await db.query(
      `SELECT cfu.*, fs.name AS sequence_name, c.name, c.phone
       FROM contact_follow_ups cfu
       JOIN follow_up_sequences fs ON fs.id = cfu.sequence_id
       JOIN contacts c ON c.id = cfu.contact_id
       WHERE cfu.completed_at IS NULL
       ORDER BY cfu.started_at DESC`
    ).catch(err => {
      console.error('[messageSequences] DB query error:', err.message);
      return { rows: [] };
    });

    for (const cfu of activeFollowUps) {
      try {
        // Find the next unsent message
        const { rows: nextMsg } = await db.query(
          `SELECT * FROM follow_up_messages
           WHERE sequence_id = $1 AND step_order > $2
           ORDER BY step_order LIMIT 1`,
          [cfu.sequence_id, cfu.last_sent_step || 0]
        );

        if (!nextMsg[0]) {
          // No more messages, mark sequence as complete
          await db.query(
            `UPDATE contact_follow_ups SET completed_at = now() WHERE id = $1`,
            [cfu.id]
          );
          continue;
        }

        const nextMessage = nextMsg[0];
        const msElapsed = now.getTime() - new Date(cfu.started_at).getTime();
        const hoursElapsed = msElapsed / (3600 * 1000);

        // Is this message due to send?
        if (hoursElapsed >= nextMessage.hours_after_start) {
          try {
            // Substitute template variables
            let messageText = nextMessage.message_text;
            messageText = messageText.replace(/\{\{contact\.name\}\}/g, cfu.name || 'there');

            // Send via SMS if phone exists
            if (cfu.phone) {
              try {
                await sendSms(cfu.phone, messageText);
              } catch (smsErr) {
                console.warn(`[messageSequences] SMS send failed for ${cfu.phone}:`, smsErr.message);
                // Log but continue - SMS failure shouldn't block database update
              }
            }

            // Mark as sent in database
            await db.query(
              `INSERT INTO follow_up_sends (contact_follow_up_id, message_id, channel)
               VALUES ($1,$2,$3)`,
              [cfu.id, nextMessage.id, 'sms']
            );

            // Update the follow-up to track which step was sent
            await db.query(
              `UPDATE contact_follow_ups SET last_sent_step = $1 WHERE id = $2`,
              [nextMessage.step_order, cfu.id]
            );

            console.log(`[messageSequences] Sent message ${nextMessage.step_order} to ${cfu.phone}`);
            sent += 1;
          } catch (err) {
            console.error(`[messageSequences] Error processing message for ${cfu.name}:`, err.message);
            failedLeads.push({ contact: cfu.name, error: err.message });
            errors += 1;
          }
        }
      } catch (err) {
        console.error(`[messageSequences] Error in sequence loop:`, err.message);
        errors += 1;
      }
    }
  } catch (err) {
    console.error('[messageSequences] Fatal error:', err.message);
  }

  const summary = { sent, errors, checked: activeFollowUps.length, failedLeads, timestamp: new Date().toISOString() };
  console.log('[messageSequences] Summary:', JSON.stringify(summary));
  return summary;
}

module.exports = { sendSequenceMessages };

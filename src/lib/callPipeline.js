const db = require('./db');
const { syncRecentCalls, downloadRecording } = require('./ringcentralCalls');
const { transcribeAudioBuffer } = require('./transcription');
const { analyzeTranscript } = require('./callAnalysis');

/** Transcribes + scores a single call row already in the DB. Safe to re-run. */
async function processCall(callId, recordingContentUri) {
  await db.query(`UPDATE calls SET transcript_status = 'processing' WHERE id = $1`, [callId]);
  try {
    const buffer = await downloadRecording(recordingContentUri);
    const transcript = await transcribeAudioBuffer(buffer);

    await db.query(
      `UPDATE calls SET transcript = $1, transcript_status = 'done' WHERE id = $2`,
      [transcript, callId]
    );

    const scorecard = await analyzeTranscript(transcript);
    await db.query(
      `INSERT INTO call_scores (call_id, overall_score, categories, strengths, weaknesses,
                                 missed_opportunities, customer_signals, coaching_priority,
                                 next_call_recommendation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        callId,
        scorecard.overall_score,
        JSON.stringify(scorecard.categories),
        JSON.stringify(scorecard.strengths),
        JSON.stringify(scorecard.weaknesses),
        JSON.stringify(scorecard.missed_opportunities),
        JSON.stringify(scorecard.customer_signals),
        scorecard.coaching_priority,
        scorecard.next_call_recommendation,
      ]
    );
    return { callId, ok: true, score: scorecard.overall_score };
  } catch (err) {
    await db.query(`UPDATE calls SET transcript_status = 'failed' WHERE id = $1`, [callId]);
    return { callId, ok: false, error: err.message };
  }
}

/**
 * Full run: pull new calls since `sinceISO` (default: last 24h), then
 * transcribe + score every one that has a recording. Runs synchronously
 * and can take a few minutes if there are several calls with recordings —
 * that's expected for now (no background job queue yet).
 */
async function runCallSync(sinceISO) {
  const since = sinceISO || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { fetched, newCalls } = await syncRecentCalls(since);

  const results = [];
  for (const { call, recordingContentUri } of newCalls) {
    if (!recordingContentUri) continue; // no recording available for this call
    results.push(await processCall(call.id, recordingContentUri));
  }

  return { fetched, newCalls: newCalls.length, processed: results.length, results };
}

module.exports = { runCallSync, processCall };

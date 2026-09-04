const db = require('./db');
const config = require('../config');
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
      `UPDATE calls SET transcript = $1, transcript_status = 'done', last_error = NULL WHERE id = $2`,
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
    // eslint-disable-next-line no-console
    console.error(`[callPipeline] call ${callId} failed:`, err.message);
    await db.query(
      `UPDATE calls SET transcript_status = 'failed', last_error = $1 WHERE id = $2`,
      [err.message.slice(0, 2000), callId]
    );
    return { callId, ok: false, error: err.message };
  }
}

/**
 * Full run: re-scan the lookback window (see config.callSync.lookbackHours),
 * saving any brand-new calls AND re-surfacing any call that previously got
 * stuck or failed. Only processes up to config.callSync.maxProcessPerRun of
 * them per call to this function, so a big backlog can't make a single HTTP
 * request run long enough to hit a platform timeout — call this again (or
 * let the hourly cron job run) to keep working through the rest.
 */
async function runCallSync() {
  const { fetched, newlyInserted, toProcess } = await syncRecentCalls();

  const batch = toProcess.slice(0, config.callSync.maxProcessPerRun);
  const results = [];
  for (const { call, recordingContentUri } of batch) {
    results.push(await processCall(call.id, recordingContentUri));
  }

  return {
    fetched,
    newCalls: newlyInserted,
    pendingBeforeThisRun: toProcess.length,
    processed: results.length,
    remaining: toProcess.length - results.length,
    results,
  };
}

module.exports = { runCallSync, processCall };

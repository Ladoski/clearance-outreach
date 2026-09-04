const config = require('../config');

const BASE = 'https://api.assemblyai.com/v2';

/** Uploads raw audio bytes to AssemblyAI, returns their hosted upload_url. */
async function uploadAudio(buffer) {
  const resp = await fetch(`${BASE}/upload`, {
    method: 'POST',
    headers: { authorization: config.assemblyai.apiKey },
    body: buffer,
  });
  if (!resp.ok) throw new Error(`AssemblyAI upload failed: ${resp.status} ${await resp.text()}`);
  const json = await resp.json();
  return json.upload_url;
}

/** Kicks off transcription for an uploaded audio URL. */
async function requestTranscript(audioUrl) {
  const resp = await fetch(`${BASE}/transcript`, {
    method: 'POST',
    headers: { authorization: config.assemblyai.apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ audio_url: audioUrl, speaker_labels: true }),
  });
  if (!resp.ok) throw new Error(`AssemblyAI transcript request failed: ${resp.status} ${await resp.text()}`);
  const json = await resp.json();
  return json.id;
}

/** Polls until the transcript is done (or errors). ~2-4 min for a typical sales call. */
async function pollTranscript(id, { intervalMs = 4000, maxWaitMs = 6 * 60 * 1000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const resp = await fetch(`${BASE}/transcript/${id}`, {
      headers: { authorization: config.assemblyai.apiKey },
    });
    const json = await resp.json();
    if (json.status === 'completed') return json;
    if (json.status === 'error') throw new Error(`AssemblyAI transcription error: ${json.error}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('AssemblyAI transcription timed out');
}

/** Full pipeline: raw audio buffer -> speaker-labeled transcript text. */
async function transcribeAudioBuffer(buffer) {
  if (!config.assemblyai.apiKey) throw new Error('ASSEMBLYAI_API_KEY is not set');
  const uploadUrl = await uploadAudio(buffer);
  const transcriptId = await requestTranscript(uploadUrl);
  const result = await pollTranscript(transcriptId);

  if (result.utterances && result.utterances.length) {
    return result.utterances.map((u) => `Speaker ${u.speaker}: ${u.text}`).join('\n');
  }
  return result.text || '';
}

module.exports = { transcribeAudioBuffer };

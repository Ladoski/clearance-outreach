const config = require('../config');

const SYSTEM_PROMPT = `You are a sales call coach. You will be given a speaker-labeled transcript of \
a phone sales call. Score it and coach the salesperson honestly and specifically.

Use this framework out of 100 total points:
- opening (0-10): confidence, rapport, professionalism, clear opening
- discovery (0-20): meaningful questions, understanding needs, pain, motivation
- qualification (0-10): budget, authority, need, timing, fit
- objection_handling (0-15): objections acknowledged, addressed with value, not rushed
- closing (0-15): clear ask, commitment, concrete next step
- communication (0-10): listening, talk/listen ratio, clarity, pace, filler words

You do not know which speaker label is the salesperson vs the customer — infer it from \
context (the salesperson asks discovery questions, presents the offer, handles objections; \
the customer asks about price/terms and raises concerns).

Prioritize honest, non-manipulative, customer-first coaching. Do not encourage pressure \
tactics. If the transcript is too short or unclear to score meaningfully, still return the \
JSON shape below but explain that in "weaknesses" and give a low-confidence score.

Respond with ONLY valid JSON, no markdown fences, no preamble, matching exactly this shape:
{
  "overall_score": <0-100 integer>,
  "categories": {
    "opening": <0-10>,
    "discovery": <0-20>,
    "qualification": <0-10>,
    "objection_handling": <0-15>,
    "closing": <0-15>,
    "communication": <0-10>
  },
  "strengths": ["...", "..."],
  "weaknesses": ["...", "..."],
  "missed_opportunities": ["...", "..."],
  "customer_signals": ["...", "..."],
  "coaching_priority": "one specific, actionable focus for the next call",
  "next_call_recommendation": "specific strategy for the next interaction with this contact"
}`;

/** Sends the transcript to Claude and returns the parsed, validated scorecard. */
async function analyzeTranscript(transcript) {
  if (!config.anthropic.apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  if (!transcript || transcript.trim().length < 20) {
    throw new Error('Transcript too short to analyze');
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.anthropic.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.anthropic.model,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Transcript:\n\n${transcript}` }],
    }),
  });

  if (!resp.ok) {
    throw new Error(`Anthropic API error: ${resp.status} ${await resp.text()}`);
  }
  const json = await resp.json();
  const text = (json.content || []).map((b) => b.text || '').join('');

  let parsed;
  try {
    const cleaned = text.replace(/^```json\s*|```$/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse AI scoring response as JSON: ${err.message}`);
  }

  validateScorecard(parsed);
  return parsed;
}

function validateScorecard(obj) {
  const required = [
    'overall_score', 'categories', 'strengths', 'weaknesses',
    'missed_opportunities', 'customer_signals', 'coaching_priority', 'next_call_recommendation',
  ];
  for (const key of required) {
    if (!(key in obj)) throw new Error(`AI scoring response missing field: ${key}`);
  }
  const catKeys = ['opening', 'discovery', 'qualification', 'objection_handling', 'closing', 'communication'];
  for (const key of catKeys) {
    if (typeof obj.categories[key] !== 'number') {
      throw new Error(`AI scoring response missing category: ${key}`);
    }
  }
}

module.exports = { analyzeTranscript };

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1); // Railway sits behind a proxy — needed for accurate per-IP rate limiting
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'concord.html'));
});

// AI calls cost real money per request — capped generously for normal use, tight enough to block abuse.
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests right now — please wait a few minutes and try again.' }
});

// Verse lookups are free but still worth capping so one client can't hammer bible-api.com through us.
const verseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests right now — please wait a few minutes and try again.' }
});

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

if (!ANTHROPIC_API_KEY) {
  console.warn(
    '\n⚠️  ANTHROPIC_API_KEY is not set.\n' +
    '   Copy .env.example to .env and add your key, or the /api routes will fail.\n'
  );
}

async function callClaude(prompt, maxTokens = 1000) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  const raw = (data.content || []).map(b => b.text || '').join('\n');
  const clean = raw.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    throw new Error('Model did not return valid JSON');
  }
}

// Explain a specific passage and suggest additional cross-references.
// Cached by reference — the explanation for a given verse rarely needs to be regenerated per user.
const explanationCache = new Map();
const EXPLANATION_CACHE_MAX = 500;

app.post('/api/explain', aiLimiter, async (req, res) => {
  try {
    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY' });

    const { ref, text, curatedRefs = [] } = req.body || {};
    if (!ref) return res.status(400).json({ error: 'Missing "ref" in request body' });

    const cacheKey = ref.trim().toLowerCase();
    if (explanationCache.has(cacheKey)) {
      return res.json(explanationCache.get(cacheKey));
    }

    const prompt = `You are a careful, denominationally neutral Bible study assistant.
Passage reference: ${ref}
${text ? `Passage text: "${text}"` : 'Full text was not supplied; rely on general knowledge of this passage and stay cautious about exact wording.'}

Respond with ONLY a JSON object, no markdown fences, no preamble, in exactly this shape:
{
  "summary": "2-3 sentence plain-English summary of what this passage communicates",
  "context": "2-3 sentences of historical or literary context: who wrote it, to whom, and what surrounds it",
  "application": "1-2 sentences on a practical, non-preachy takeaway for a reader today",
  "suggestedRefs": [{"ref": "Book Chapter:Verse", "reason": "short phrase, under 8 words"}]
}
Provide up to 4 suggestedRefs that are thematically connected but different from these already-listed cross-references: ${JSON.stringify(curatedRefs)}.
Keep the tone warm, plain-spoken, and non-sectarian.`;

    const parsed = await callClaude(prompt, 1000);

    if (explanationCache.size >= EXPLANATION_CACHE_MAX) {
      explanationCache.delete(explanationCache.keys().next().value); // evict oldest
    }
    explanationCache.set(cacheKey, parsed);

    res.json(parsed);
  } catch (err) {
    console.error('[/api/explain]', err.message);
    res.status(502).json({ error: err.message || 'Unknown error contacting the model' });
  }
});

// Map a described life situation onto a short guided path through scripture.
// Cached by the exact situation text — helps if the same phrase gets submitted more than once,
// though freeform input means most requests will still be fresh calls.
const situationCache = new Map();
const SITUATION_CACHE_MAX = 200;

app.post('/api/situation', aiLimiter, async (req, res) => {
  try {
    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY' });

    const { situationText } = req.body || {};
    if (!situationText || !situationText.trim()) {
      return res.status(400).json({ error: 'Missing "situationText" in request body' });
    }

    const cacheKey = situationText.trim().toLowerCase();
    if (situationCache.has(cacheKey)) {
      return res.json(situationCache.get(cacheKey));
    }

    const prompt = `You are a thoughtful, denominationally neutral Bible study guide.
Someone shared what's going on in their life: "${situationText}"

Choose a short guided path of 3 Bible passages (well-known verses, easy to find) that speak to their situation, moving from acknowledgment toward encouragement or direction. Respond with ONLY a JSON object, no markdown fences, no preamble, in exactly this shape:
{
  "path": [
    {"ref": "Book Chapter:Verse", "reason": "1-2 sentences, speaking directly to what they shared, warm and specific, not generic"},
    {"ref": "Book Chapter:Verse", "reason": "..."},
    {"ref": "Book Chapter:Verse", "reason": "..."}
  ]
}
Prefer well-known passages when they genuinely fit. Do not diagnose or moralize — just explain why each passage is relevant to what they described.`;

    const parsed = await callClaude(prompt, 1000);

    if (situationCache.size >= SITUATION_CACHE_MAX) {
      situationCache.delete(situationCache.keys().next().value);
    }
    situationCache.set(cacheKey, parsed);

    res.json(parsed);
  } catch (err) {
    console.error('[/api/situation]', err.message);
    res.status(502).json({ error: err.message || 'Unknown error contacting the model' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    keyConfigured: !!ANTHROPIC_API_KEY,
    model: MODEL,
    cacheSizes: { explanations: explanationCache.size, situations: situationCache.size, verses: verseCache.size }
  });
});

// Full-Bible verse lookup for anything outside the curated library.
// Backed by bible-api.com — free, no key required, public-domain translations only.
const verseCache = new Map();

app.get('/api/verse', verseLimiter, async (req, res) => {
  try {
    const ref = (req.query.ref || '').trim();
    const translation = (req.query.translation || 'kjv').toLowerCase();
    if (!ref) return res.status(400).json({ error: 'Missing "ref" query parameter' });

    const cacheKey = `${translation}:${ref.toLowerCase()}`;
    if (verseCache.has(cacheKey)) {
      return res.json(verseCache.get(cacheKey));
    }

    const url = `https://bible-api.com/${encodeURIComponent(ref)}?translation=${encodeURIComponent(translation)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`bible-api.com returned ${response.status}`);
    }
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    if (!data.text) throw new Error('No text returned for that reference');

    const result = {
      ref: data.reference || ref,
      text: data.text.trim().replace(/\s+/g, ' '),
      translation: data.translation_name || translation.toUpperCase()
    };
    verseCache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('[/api/verse]', err.message);
    res.status(502).json({ error: err.message || 'Unknown error fetching verse' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Concord server running on port ${PORT}`);
});

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'concord.html'));
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
app.post('/api/explain', async (req, res) => {
  try {
    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY' });

    const { ref, text, curatedRefs = [] } = req.body || {};
    if (!ref) return res.status(400).json({ error: 'Missing "ref" in request body' });

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
    res.json(parsed);
  } catch (err) {
    console.error('[/api/explain]', err.message);
    res.status(502).json({ error: err.message || 'Unknown error contacting the model' });
  }
});

// Map a described life situation onto a short guided path through scripture.
app.post('/api/situation', async (req, res) => {
  try {
    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY' });

    const { situationText } = req.body || {};
    if (!situationText || !situationText.trim()) {
      return res.status(400).json({ error: 'Missing "situationText" in request body' });
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
    res.json(parsed);
  } catch (err) {
    console.error('[/api/situation]', err.message);
    res.status(502).json({ error: err.message || 'Unknown error contacting the model' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, keyConfigured: !!ANTHROPIC_API_KEY, model: MODEL });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Concord server running on port ${PORT}`);
});

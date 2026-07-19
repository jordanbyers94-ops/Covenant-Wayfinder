# Concord — server

A small Express backend for the Concord Bible-study app. It serves the front end
and proxies the two AI calls (passage explanations, situational guided paths) to
the Anthropic API, so your API key stays server-side and is never exposed to the browser.

## Setup

```bash
npm install
cp .env.example .env
```

Open `.env` and add your own key from https://console.anthropic.com/:

```
ANTHROPIC_API_KEY=sk-ant-...
```

## Run

```bash
npm start
```

Then open **http://localhost:3000**

For auto-restart on file changes during development:

```bash
npm run dev
```

## What's here

- `server.js` — Express app. Two routes:
  - `POST /api/explain` — takes `{ ref, text, curatedRefs }`, returns the Summary/Context/Application breakdown plus suggested cross-references.
  - `POST /api/situation` — takes `{ situationText }`, returns a 3-step guided path through scripture.
  - `GET /api/health` — quick check that the server is up and whether a key is configured.
- `public/concord.html` — the whole front end (styles, markup, and client JS in one file). It calls the two routes above by relative path, no key needed in the browser.
- `.env.example` — copy to `.env` and fill in your key. `.env` is gitignored.

## Notes

- The curated verse text (KJV, and WEB where verified) lives client-side in `public/concord.html` — it's public domain, so there's no need to route it through the server.
- If you deploy this somewhere public, keep `.env` out of version control (already handled by `.gitignore`) and set `ANTHROPIC_API_KEY` as an environment variable on your host instead.
- Model used is `claude-sonnet-5` by default — override with `ANTHROPIC_MODEL` in `.env` if you want to try `claude-haiku-4-5-20251001` for lower cost.

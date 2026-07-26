// Basic smoke tests for the Wayfinder server.
// Run with: npm test
// Uses Node's built-in test runner (Node 18+) — no extra dependencies.
// Spins up the real server on a separate test port, hits real HTTP endpoints,
// and shuts it down when done.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PORT = 3999;
const BASE_URL = `http://localhost:${TEST_PORT}`;

let serverProcess;

before(async () => {
  serverProcess = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(TEST_PORT) },
    stdio: 'pipe'
  });

  // Wait for the server to actually start accepting connections
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not start in time')), 8000);
    serverProcess.stdout.on('data', (data) => {
      if (data.toString().includes('running on port')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    serverProcess.on('error', reject);
  });
});

after(() => {
  if (serverProcess) serverProcess.kill();
});

test('GET / returns 200 and serves the app', async () => {
  const res = await fetch(`${BASE_URL}/`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(body.includes('Wayfinder'), 'response should contain "Wayfinder"');
});

test('GET /privacy.html returns 200', async () => {
  const res = await fetch(`${BASE_URL}/privacy.html`);
  assert.equal(res.status, 200);
});

test('GET /terms.html returns 200', async () => {
  const res = await fetch(`${BASE_URL}/terms.html`);
  assert.equal(res.status, 200);
});

test('GET /api/health returns expected shape', async () => {
  const res = await fetch(`${BASE_URL}/api/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok('keyConfigured' in data);
  assert.ok('model' in data);
  assert.ok('cacheSizes' in data);
});

test('POST /api/explain with no body returns 400', async () => {
  const res = await fetch(`${BASE_URL}/api/explain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /Missing "ref"/);
});

test('POST /api/explain with an oversized ref returns 400', async () => {
  const res = await fetch(`${BASE_URL}/api/explain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'x'.repeat(200) })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /too long/i);
});

test('POST /api/situation with no body returns 400', async () => {
  const res = await fetch(`${BASE_URL}/api/situation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /Missing "situationText"/);
});

test('POST /api/situation with oversized text returns 400', async () => {
  const res = await fetch(`${BASE_URL}/api/situation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ situationText: 'x'.repeat(700) })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /too long/i);
});

test('GET /api/verse with no ref returns 400', async () => {
  const res = await fetch(`${BASE_URL}/api/verse`);
  assert.equal(res.status, 400);
});

test('GET /api/verse with an oversized ref returns 400', async () => {
  const res = await fetch(`${BASE_URL}/api/verse?ref=${'x'.repeat(200)}`);
  assert.equal(res.status, 400);
});

test('POST /api/explain sends rate-limit headers', async () => {
  const res = await fetch(`${BASE_URL}/api/explain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'John 3:16' })
  });
  assert.ok(res.headers.get('ratelimit-limit'), 'expected a RateLimit-Limit header');
});

test('unknown API route returns 404, not a crash', async () => {
  const res = await fetch(`${BASE_URL}/api/does-not-exist`);
  assert.equal(res.status, 404);
});

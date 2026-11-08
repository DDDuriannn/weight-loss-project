import test from 'node:test';
import assert from 'node:assert/strict';
import { createQaHandler, createQaServices } from '../supabase/functions/qa/handler.js';

const ORIGIN = 'https://ddduriannn.github.io';
const PROJECT = 'https://qa-example.supabase.co';
const EDGE = `${PROJECT}/functions/v1/qa`;
const OWNER = 'b807ae12-af95-4af7-a90e-eb2c72e20001';
const OTHER = 'b807ae12-af95-4af7-a90e-eb2c72e20002';
const REQUEST_ID = '7d0aa942-5d8f-4bee-b278-02082fc055aa';
const ROW = {
  id: 'abc88c1a-40e2-4fde-a40e-50a7f2690a71',
  question: '今天做了什么？', reply: '跑了步。', status: 'published',
  published_at: '2026-11-08T01:01:01+00:00', created_at: '2026-11-08T01:00:00+00:00',
  updated_at: '2026-11-08T01:01:01.123456+00:00', request_id: REQUEST_ID,
};
const PROOF = { success: true, hostname: 'ddduriannn.github.io', action: 'qa_submit' };
const publicRow = { id: ROW.id, question: ROW.question, reply: ROW.reply, publishedAt: ROW.published_at };
const adminRow = { ...publicRow, createdAt: ROW.created_at, status: ROW.status, updatedAt: ROW.updated_at };

function handler({ repository, ...options } = {}) {
  return createQaHandler({
    allowedOrigin: ORIGIN,
    ownerId: OWNER,
    verifyAccessToken: async (token) => ({ owner: OWNER, other: OTHER })[token] ?? null,
    verifyCaptcha: async () => PROOF,
    ...options,
    repository: {
      list: async () => [],
      hasRequest: async () => false,
      submit: async () => 'inserted',
      moderate: async () => ({ outcome: 'updated', question: ROW }),
      ...repository,
    },
  });
}

function request(path = '', { method = 'GET', origin = ORIGIN, token, body, raw } = {}) {
  const headers = new Headers();
  if (origin !== null) headers.set('origin', origin);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (body !== undefined || raw !== undefined) headers.set('content-type', 'application/json');
  return new Request(`${EDGE}${path}`, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
}

function submitRequest(overrides = {}) {
  return request('', { method: 'POST', body: { question: ROW.question, requestId: REQUEST_ID, captchaToken: 'proof', ...overrides } });
}

async function expectError(response, status, error) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error });
}

test('Q&A serves only the configured origin and supports preflight without accessing the database', async () => {
  let lists = 0;
  const handle = handler({ repository: { list: async () => { lists++; return []; } } });
  for (const origin of [null, 'https://example.test', `${ORIGIN}/weight-loss-project`]) {
    const response = await handle(request('', { origin }));
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    await expectError(response, 403, 'forbidden');
  }
  const preflight = await handle(request(`/admin/${ROW.id}`, { method: 'OPTIONS' }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);
  assert.match(preflight.headers.get('access-control-allow-methods'), /PATCH/);
  assert.match(preflight.headers.get('access-control-allow-headers'), /authorization/);
  assert.equal(lists, 0);
});

test('public question pages only request published rows and serialize at most 20 public fields', async () => {
  const queries = [];
  const handle = handler({ repository: { list: async (query) => {
    queries.push(query);
    return Array.from({ length: query.offset === 5 ? 21 : 1 }, () => ROW);
  } } });
  const first = await handle(request('?offset=5&status=pending'));
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await first.json(), { questions: Array(20).fill(publicRow), nextOffset: 25 });
  const last = await handle(new Request(`${PROJECT}/qa?offset=25`, { headers: { origin: ORIGIN } }));
  assert.deepEqual(await last.json(), { questions: [publicRow], nextOffset: null });
  assert.deepEqual(queries, [5, 25].map((offset) => ({ status: 'published', offset, limit: 21, publicView: true })));
  await expectError(await handle(request('?offset=-1')), 400, 'invalid_input');
  await expectError(await handle(request('?offset=1.5')), 400, 'invalid_input');
});

test('submission trims text and enforces Unicode length and payload bounds before verification', async () => {
  const writes = [];
  let challenges = 0;
  const handle = handler({
    verifyCaptcha: async () => { challenges++; return PROOF; },
    repository: { submit: async (...args) => { writes.push(args); return 'inserted'; } },
  });
  const text = '🍎'.repeat(1000);
  const response = await handle(submitRequest({ question: `  ${text}\n`, requestId: REQUEST_ID.toUpperCase() }));
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(writes, [[REQUEST_ID, text]]);
  for (const overrides of [
    { question: '🍎'.repeat(1001) }, { question: '  ' }, { question: 'bad\0text' },
    { requestId: 'not-a-uuid' }, { captchaToken: '' }, { captchaToken: 'a'.repeat(2049) },
  ]) {
    await expectError(await handle(submitRequest(overrides)), 400, 'invalid_input');
  }
  await expectError(await handle(request('', { method: 'POST', raw: '{broken' })), 400, 'invalid_input');
  await expectError(await handle(submitRequest({ padding: 'a'.repeat(32_768) })), 400, 'invalid_input');
  assert.equal(challenges, 1);
});

test('submission rejects failed, wrong-host and wrong-action Turnstile proofs', async () => {
  for (const proof of [{ success: false }, { ...PROOF, hostname: 'example.test' }, { ...PROOF, action: 'another_form' }]) {
    let inserted = false;
    const handle = handler({
      verifyCaptcha: async () => proof,
      repository: { submit: async () => { inserted = true; return 'inserted'; } },
    });
    await expectError(await handle(submitRequest()), 400, 'captcha_failed');
    assert.equal(inserted, false);
  }
});

test('submission retries acknowledge existing IDs, while the database controls new admissions', async () => {
  let challenges = 0;
  let writes = 0;
  const duplicate = handler({
    verifyCaptcha: async () => { challenges++; return { success: false }; },
    repository: {
      hasRequest: async (id) => id === REQUEST_ID,
      submit: async () => { writes++; return 'inserted'; },
    },
  });
  const response = await duplicate(submitRequest({ captchaToken: 'previously-consumed-token' }));
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual([challenges, writes], [0, 0]);
  const race = handler({ repository: { submit: async () => 'duplicate' } });
  assert.deepEqual(await (await race(submitRequest())).json(), { ok: true });
  const full = handler({ repository: { submit: async () => 'rate_limited' } });
  await expectError(await full(submitRequest()), 429, 'rate_limited');
  const unavailable = handler({ repository: { submit: async () => { throw new Error('internal details'); } } });
  await expectError(await unavailable(submitRequest()), 500, 'server_error');
});

test('moderation only accepts a verified owner token and returns a private page for each status', async () => {
  const queries = [];
  const handle = handler({ repository: { list: async (query) => {
    queries.push(query);
    return [{ ...ROW, status: query.status }];
  } } });
  for (const token of [undefined, 'expired']) {
    await expectError(await handle(request('/admin?status=pending', { token })), 401, 'unauthorized');
  }
  await expectError(await handle(request('/admin?status=pending', { token: 'other' })), 403, 'forbidden');
  await expectError(await handle(request('/admin?status=hidden', { token: 'owner' })), 400, 'invalid_input');
  assert.deepEqual(queries, []);
  for (const status of ['pending', 'published', 'archived']) {
    const response = await handle(request(`/admin?status=${status}&offset=20`, { token: 'owner' }));
    assert.deepEqual(await response.json(), { questions: [{ ...adminRow, status }], nextOffset: null });
  }
  assert.deepEqual(queries, ['pending', 'published', 'archived'].map((status) => ({ status, offset: 20, limit: 21, publicView: false })));
});

test('admin actions forward the exact version and surface transaction conflicts and missing rows', async () => {
  const calls = [];
  let outcome = 'updated';
  const handle = handler({ repository: { moderate: async (...args) => {
    calls.push(args);
    return { outcome, question: ROW };
  } } });
  const patch = (action, overrides = {}) => request(`/admin/${ROW.id}`, {
    method: 'PATCH', token: 'owner', body: { action, updatedAt: ROW.updated_at, ...overrides },
  });
  for (const action of ['publish', 'unpublish', 'archive', 'restore']) {
    const response = await handle(patch(action, { reply: '  修改后的回复  ' }));
    assert.deepEqual(await response.json(), { question: adminRow });
  }
  assert.deepEqual(calls, ['publish', 'unpublish', 'archive', 'restore'].map((action) => [
    ROW.id, action, action === 'publish' ? '修改后的回复' : null, ROW.updated_at,
  ]));
  await expectError(await handle(patch('publish', { reply: '  ' })), 400, 'invalid_input');
  await expectError(await handle(patch('publish', { reply: '🍎'.repeat(2001) })), 400, 'invalid_input');
  await expectError(await handle(patch('archive', { updatedAt: '2026-02-30T12:00:00Z' })), 400, 'invalid_input');
  assert.equal(calls.length, 4);
  outcome = 'conflict';
  await expectError(await handle(patch('archive')), 409, 'conflict');
  outcome = 'not_found';
  await expectError(await handle(patch('restore')), 404, 'not_found');
});

test('remote services use distinct credentials for Auth, Turnstile and the service-only database RPC', async () => {
  const requests = [];
  const services = createQaServices({
    supabaseUrl: PROJECT,
    databaseKey: 'sb_secret_mock',
    publishableKey: 'sb_publishable_mock',
    turnstileSecret: 'turnstile-mock',
    fetchImpl: async (url, options) => {
      requests.push({ url, ...options });
      if (url.pathname === '/auth/v1/user') return Response.json({ id: OWNER });
      if (url.hostname === 'challenges.cloudflare.com') return Response.json(PROOF);
      if (url.pathname === '/rest/v1/rpc/qa_submit') return Response.json('inserted');
      return Response.json([]);
    },
  });
  const handle = createQaHandler({ ...services, allowedOrigin: ORIGIN, ownerId: OWNER });
  assert.deepEqual(await (await handle(submitRequest())).json(), { ok: true });
  assert.deepEqual(await (await handle(request('/admin?status=pending', { token: 'verified-jwt' }))).json(), {
    questions: [], nextOffset: null,
  });
  const [dedupe, captcha, insert, auth, admin] = requests;
  assert.equal(dedupe.url.searchParams.get('request_id'), `eq.${REQUEST_ID}`);
  assert.deepEqual(dedupe.headers, { apikey: 'sb_secret_mock' });
  assert.equal(captcha.url.href, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.deepEqual(Object.fromEntries(captcha.body), { secret: 'turnstile-mock', response: 'proof' });
  assert.equal(captcha.headers, undefined);
  assert.deepEqual(JSON.parse(insert.body), { p_request_id: REQUEST_ID, p_question: ROW.question });
  assert.deepEqual(auth.headers, { apikey: 'sb_publishable_mock', authorization: 'Bearer verified-jwt' });
  assert.equal(admin.url.searchParams.get('status'), 'eq.pending');
  assert.equal(admin.url.searchParams.get('limit'), '21');
  assert.doesNotMatch(admin.url.searchParams.get('select'), /request_id/);
  assert.ok(requests.every(({ redirect }) => redirect === 'error'));
});

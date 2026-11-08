import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createQaClient, QaError } from '../src/qa/api.js';
import { initAdminQa } from '../src/qa/admin.js';
import { initPublicQa } from '../src/qa/public.js';

const timestamp = '2026-11-08T12:30:00.123456Z';
const flush = () => new Promise(setImmediate);

function page(path, marker) {
  const window = new Window({
    settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
  });
  window.document.write(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
  const root = window.document.querySelector(marker);
  return {
    window,
    root,
    get: (selector) => root.querySelector(selector),
    submit: (form) => form.dispatchEvent(new window.Event('submit', { cancelable: true })),
    close: async () => { await window.happyDOM.abort(); window.close(); },
  };
}

test('Q&A client uses the public API key and only sends a bearer token on owner requests', async () => {
  const calls = [];
  const client = createQaClient({ supabaseUrl: 'https://example.supabase.co', publishableKey: 'fixture-key' }, async (url, options) => {
    calls.push({ url: new URL(url), method: options.method, headers: new Headers(options.headers), body: options.body });
    if (url.includes('/token?')) return Response.json({ access_token: 'fixture-owner', expires_in: 3600 });
    if (url.includes('/logout?')) return new Response(null, { status: 204 });
    return Response.json({ ok: true });
  });
  await client.listQuestions(20);
  const session = await client.signIn('fixture@example.test', 'fixture-password');
  await client.listAdmin('archived', 0, session.token);
  await client.updateQuestion('question-id', { action: 'restore', updatedAt: timestamp }, session.token);
  await client.signOut(session.token);

  assert.equal(calls[0].url.pathname, '/functions/v1/qa');
  assert.equal(calls[0].url.searchParams.get('offset'), '20');
  assert.equal(calls[0].headers.get('apikey'), 'fixture-key');
  assert.equal(calls[0].headers.has('Authorization'), false);
  assert.equal(calls[1].url.searchParams.get('grant_type'), 'password');
  assert.equal(calls[1].headers.has('Authorization'), false);
  assert.equal(calls[2].url.searchParams.get('status'), 'archived');
  assert.equal(calls[3].method, 'PATCH');
  assert.equal(JSON.parse(calls[3].body).updatedAt, timestamp);
  assert.equal(calls[4].url.searchParams.get('scope'), 'local');
  assert.ok(calls.slice(2).every(({ headers }) => headers.get('Authorization') === 'Bearer fixture-owner'));
});

test('public questions paginate as plain text and a failed submission retains its draft and request ID', async () => {
  const env = page('questions/index.html', '[data-qa-public]');
  const offsets = [];
  const submissions = [];
  const sample = '<img src=x onerror=alert(1)>\n文字保留';
  let id = 0;
  let captcha = 0;
  try {
    await initPublicQa(env.root, {
      client: {
        async listQuestions(offset) {
          offsets.push(offset);
          return { questions: [{ question: sample, reply: '好的。', publishedAt: timestamp }], nextOffset: offset ? null : 20 };
        },
        async submitQuestion(body) {
          submissions.push(body);
          if (submissions.length < 3) throw new QaError('network_error');
          return { ok: true };
        },
      },
      verify: async () => `captcha-${++captcha}`,
      makeId: () => `request-${++id}`,
    });
    assert.equal(env.get('.qa-question-copy').textContent, sample);
    assert.equal(env.get('[data-qa-questions] img'), null);
    env.get('[data-qa-more]').click();
    await flush();
    assert.deepEqual(offsets, [0, 20]);
    assert.equal(env.get('[data-qa-more]').hidden, true);

    const form = env.get('[data-qa-form]');
    const input = env.get('[data-qa-question]');
    input.value = '  第一个问题🙂  ';
    env.submit(form);
    await flush();
    assert.equal(input.value, '  第一个问题🙂  ');
    assert.match(env.get('[data-qa-form-message]').textContent, /草稿已保留/);
    env.submit(form);
    await flush();
    input.value = '改过的问题';
    input.dispatchEvent(new env.window.Event('input'));
    env.submit(form);
    await flush();
    assert.deepEqual(submissions, [
      { question: '第一个问题🙂', requestId: 'request-1', captchaToken: 'captcha-1' },
      { question: '第一个问题🙂', requestId: 'request-1', captchaToken: 'captcha-2' },
      { question: '改过的问题', requestId: 'request-2', captchaToken: 'captcha-3' },
    ]);
    assert.equal(input.value, '');
    assert.match(env.get('[data-qa-form-message]').textContent, /审核并回复/);
  } finally { await env.close(); }
});

test('the owner page requires backend permission and retains the reply on update conflict', async () => {
  const env = page('questions/admin/index.html', '[data-qa-admin]');
  const signOutTokens = [];
  const updates = [];
  let attempts = 0;
  try {
    initAdminQa(env.root, {
      client: {
        signIn: async () => ({ token: `token-${++attempts}`, expiresAt: Date.now() + 60_000 }),
        async listAdmin(status, offset, token) {
          if (token === 'token-1') throw new QaError('forbidden', 403);
          assert.equal(status, 'pending');
          assert.equal(offset, 0);
          return { questions: [{ id: 'q1', question: '<b>问题</b>', reply: null, status, createdAt: timestamp, updatedAt: timestamp }], nextOffset: null };
        },
        async updateQuestion(id, body, token) {
          updates.push({ id, body, token });
          if (updates.length === 1) throw new QaError('conflict', 409);
          return { question: { id, status: 'published' } };
        },
        signOut: async (token) => { signOutTokens.push(token); },
      },
    });
    const login = env.get('[data-qa-login]');
    env.get('[data-qa-email]').value = 'fixture@example.test';
    env.get('[data-qa-password]').value = 'fixture-password';
    env.submit(login);
    await flush();
    assert.equal(env.get('[data-qa-board]').hidden, true);
    assert.match(env.get('[data-qa-login-message]').textContent, /没有站主管理权限/);
    env.get('[data-qa-password]').value = 'fixture-password';
    env.submit(login);
    await flush();
    assert.equal(env.get('[data-qa-board]').hidden, false);
    assert.equal(env.get('[data-qa-password]').value, '');
    assert.equal(env.get('.qa-question-copy').textContent, '<b>问题</b>');
    assert.equal(env.get('.qa-question-copy b'), null);

    const reply = env.get('.qa-reply-input');
    reply.value = '  谢谢提问。  ';
    env.get('[data-qa-action="publish"]').click();
    await flush();
    assert.equal(reply.value, '  谢谢提问。  ');
    assert.match(env.get('.qa-admin-card [role="status"]').textContent, /请刷新列表/);
    env.get('[data-qa-action="publish"]').click();
    await flush();
    assert.deepEqual(updates[0], { id: 'q1', body: { action: 'publish', updatedAt: timestamp, reply: '谢谢提问。' }, token: 'token-2' });
    assert.equal(env.get('.qa-admin-card'), null);
    env.get('[data-qa-sign-out]').click();
    await flush();
    assert.deepEqual(signOutTokens, ['token-1', 'token-2']);
    assert.equal(env.get('[data-qa-board]').hidden, true);
  } finally {
    env.get('[data-qa-sign-out]').click();
    await env.close();
  }
});

const PAGE_SIZE = 20;
const MAX_JSON_BYTES = 32_768;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-5]):[0-5]\d)$/;
const STATUSES = new Set(['pending', 'published', 'archived']);
const ACTIONS = new Set(['publish', 'unpublish', 'archive', 'restore']);
const PUBLIC_COLUMNS = 'id,question,reply,published_at';
const ADMIN_COLUMNS = `${PUBLIC_COLUMNS},created_at,status,updated_at`;

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || !text.isWellFormed() || text.includes('\0') || [...text].length > maxLength) return null;
  return text;
}

function validTimestamp(value) {
  const match = typeof value === 'string' ? TIMESTAMP.exec(value) : null;
  if (!match || match[1].startsWith('0000')) return false;
  const date = new Date(`${match[1]}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === match[1];
}

async function readPayload(request) {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json' || !request.body) return null;

  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_JSON_BYTES) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    const payload = JSON.parse(text + decoder.decode());
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function getOffset(params) {
  const value = params.get('offset');
  if (value === null) return 0;
  const offset = Number(value);
  return /^\d+$/.test(value) && Number.isSafeInteger(offset) && offset <= Number.MAX_SAFE_INTEGER - PAGE_SIZE ? offset : null;
}

function publicQuestion(row) {
  return { id: row.id, question: row.question, reply: row.reply, publishedAt: row.published_at };
}

function adminQuestion(row) {
  return { ...publicQuestion(row), createdAt: row.created_at, status: row.status, updatedAt: row.updated_at };
}

function questionPage(rows, offset, format) {
  return {
    questions: rows.slice(0, PAGE_SIZE).map(format),
    nextOffset: rows.length > PAGE_SIZE ? offset + PAGE_SIZE : null,
  };
}

export function createQaHandler({ allowedOrigin, ownerId, repository, verifyAccessToken, verifyCaptcha }) {
  const originUrl = new URL(allowedOrigin);
  if (originUrl.protocol !== 'https:' || originUrl.origin !== allowedOrigin || !UUID.test(ownerId)) {
    throw new Error('Invalid Q&A origin or owner configuration');
  }

  const privateHeaders = { 'cache-control': 'no-store', vary: 'Origin' };
  const corsHeaders = {
    ...privateHeaders,
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
    'access-control-allow-headers': 'apikey, authorization, content-type, x-client-info',
  };
  const json = (body, status = 200) => Response.json(body, { status, headers: corsHeaders });
  const error = (code, status) => json({ error: code }, status);

  async function submit(request) {
    const payload = await readPayload(request);
    const question = cleanText(payload?.question, 1000);
    const { requestId, captchaToken } = payload ?? {};
    if (!question || typeof requestId !== 'string' || !UUID.test(requestId)
        || typeof captchaToken !== 'string' || !captchaToken.trim() || captchaToken.length > 2048) {
      return error('invalid_input', 400);
    }

    const id = requestId.toLowerCase();
    // A lost response can be retried after Turnstile consumed the original token.
    if (await repository.hasRequest(id)) return json({ ok: true });
    const captcha = await verifyCaptcha(captchaToken);
    if (captcha?.success !== true || captcha.hostname !== originUrl.hostname || captcha.action !== 'qa_submit') {
      return error('captcha_failed', 400);
    }

    const outcome = await repository.submit(id, question);
    if (outcome === 'inserted' || outcome === 'duplicate') return json({ ok: true });
    if (outcome === 'rate_limited') return error('rate_limited', 429);
    if (outcome === 'invalid_input') return error('invalid_input', 400);
    return error('server_error', 500);
  }

  async function moderate(request, id) {
    if (!UUID.test(id)) return error('invalid_input', 400);
    const payload = await readPayload(request);
    const { action, updatedAt } = payload ?? {};
    if (!ACTIONS.has(action) || !validTimestamp(updatedAt)) return error('invalid_input', 400);
    const reply = action === 'publish' ? cleanText(payload.reply, 2000) : null;
    if (action === 'publish' && reply === null) return error('invalid_input', 400);

    const result = await repository.moderate(id.toLowerCase(), action, reply, updatedAt);
    if (result?.outcome === 'updated') return json({ question: adminQuestion(result.question) });
    if (result?.outcome === 'not_found') return error('not_found', 404);
    if (result?.outcome === 'conflict') return error('conflict', 409);
    if (result?.outcome === 'invalid_input') return error('invalid_input', 400);
    return error('server_error', 500);
  }

  return async function handleQa(request) {
    if (request.headers.get('origin') !== allowedOrigin) {
      return Response.json({ error: 'forbidden' }, { status: 403, headers: privateHeaders });
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/functions\/v1(?=\/)/, '').replace(/\/$/, '');
      const isPublic = path === '/qa';
      const isAdminList = path === '/qa/admin';
      const adminId = /^\/qa\/admin\/([^/]+)$/.exec(path)?.[1];
      if (!isPublic && !isAdminList && !adminId) return error('not_found', 404);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

      if (isPublic) {
        if (request.method === 'POST') return await submit(request);
        if (request.method !== 'GET') return error('invalid_input', 405);
        const offset = getOffset(url.searchParams);
        if (offset === null) return error('invalid_input', 400);
        const rows = await repository.list({ status: 'published', offset, limit: PAGE_SIZE + 1, publicView: true });
        return json(questionPage(rows, offset, publicQuestion));
      }

      const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
      if (!token) return error('unauthorized', 401);
      const userId = await verifyAccessToken(token);
      if (!userId) return error('unauthorized', 401);
      if (userId.toLowerCase() !== ownerId.toLowerCase()) return error('forbidden', 403);

      if (adminId) return request.method === 'PATCH' ? await moderate(request, adminId) : error('invalid_input', 405);
      if (request.method !== 'GET') return error('invalid_input', 405);
      const status = url.searchParams.get('status');
      const offset = getOffset(url.searchParams);
      if (!STATUSES.has(status) || offset === null) return error('invalid_input', 400);
      const rows = await repository.list({ status, offset, limit: PAGE_SIZE + 1, publicView: false });
      return json(questionPage(rows, offset, adminQuestion));
    } catch {
      return error('server_error', 500);
    }
  };
}

export function createQaServices({ supabaseUrl, databaseKey, publishableKey, turnstileSecret, fetchImpl = fetch }) {
  const send = (url, options) => fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(8000) });
  const databaseHeaders = { apikey: databaseKey };
  if (!databaseKey.startsWith('sb_secret_')) databaseHeaders.authorization = `Bearer ${databaseKey}`;

  async function database(path, { query, body } = {}) {
    const url = new URL(`/rest/v1/${path}`, supabaseUrl);
    if (query) url.search = new URLSearchParams(query).toString();
    const response = await send(url, body ? {
      method: 'POST',
      headers: { ...databaseHeaders, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    } : { method: 'GET', headers: databaseHeaders });
    if (!response.ok) throw new Error(`Q&A database request failed (${response.status})`);
    return response.json();
  }

  return {
    repository: {
      list: ({ status, offset, limit, publicView }) => database('qa_questions', { query: {
        select: publicView ? PUBLIC_COLUMNS : ADMIN_COLUMNS,
        status: `eq.${status}`,
        order: publicView ? 'published_at.desc,id.desc' : 'created_at.desc,id.desc',
        offset: String(offset),
        limit: String(limit),
      } }),
      hasRequest: async (requestId) => (await database('qa_questions', { query: {
        select: 'id', request_id: `eq.${requestId}`, limit: '1',
      } })).length > 0,
      submit: (requestId, question) => database('rpc/qa_submit', { body: { p_request_id: requestId, p_question: question } }),
      moderate: (id, action, reply, updatedAt) => database('rpc/qa_moderate', { body: {
        p_id: id, p_action: action, p_reply: reply, p_expected_updated_at: updatedAt,
      } }),
    },
    async verifyAccessToken(token) {
      const response = await send(new URL('/auth/v1/user', supabaseUrl), {
        method: 'GET', headers: { apikey: publishableKey, authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) return null;
      if (!response.ok) throw new Error(`Q&A Auth verification failed (${response.status})`);
      const user = await response.json();
      return typeof user.id === 'string' && UUID.test(user.id) ? user.id : null;
    },
    async verifyCaptcha(token) {
      const response = await send(new URL('https://challenges.cloudflare.com/turnstile/v0/siteverify'), {
        method: 'POST', body: new URLSearchParams({ secret: turnstileSecret, response: token }),
      });
      if (!response.ok) throw new Error(`Q&A challenge verification failed (${response.status})`);
      return response.json();
    },
  };
}

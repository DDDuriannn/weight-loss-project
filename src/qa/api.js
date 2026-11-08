export class QaError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function readQaConfig() {
  const supabaseUrl = import.meta.env.VITE_QA_SUPABASE_URL?.trim();
  const publishableKey = import.meta.env.VITE_QA_SUPABASE_PUBLISHABLE_KEY?.trim();
  const siteKey = import.meta.env.VITE_QA_TURNSTILE_SITE_KEY?.trim();
  if (!supabaseUrl || !publishableKey) return null;
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      return null;
    }
    return { supabaseUrl: url.origin, publishableKey, siteKey };
  } catch {
    return null;
  }
}

export function createQaClient({ supabaseUrl, publishableKey }, fetcher = globalThis.fetch) {
  const qa = '/functions/v1/qa';
  async function request(path, { method = 'GET', token, body } = {}) {
    const headers = { apikey: publishableKey };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetcher(`${supabaseUrl}${path}`, {
        method, headers, credentials: 'omit', cache: 'no-store',
        signal: AbortSignal.timeout?.(15_000),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new QaError('network_error');
    }
    if (response.status === 204) return null;
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const fallback = { 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 429: 'rate_limited' };
      throw new QaError(typeof result?.error === 'string' ? result.error : fallback[response.status] || 'server_error', response.status);
    }
    if (!result) throw new QaError('server_error', response.status);
    return result;
  }

  return {
    listQuestions: (offset) => request(`${qa}?${new URLSearchParams({ offset })}`),
    submitQuestion: (body) => request(qa, { method: 'POST', body }),
    async signIn(email, password) {
      const session = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
      const expiresAt = session.expires_at ? session.expires_at * 1000 : Date.now() + session.expires_in * 1000;
      if (typeof session.access_token !== 'string' || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new QaError('unauthorized');
      }
      return { token: session.access_token, expiresAt };
    },
    signOut: (token) => request('/auth/v1/logout?scope=local', { method: 'POST', token }),
    listAdmin: (status, offset, token) => request(`${qa}/admin?${new URLSearchParams({ status, offset })}`, { token }),
    updateQuestion: (id, body, token) => request(`${qa}/admin/${encodeURIComponent(id)}`, { method: 'PATCH', token, body }),
  };
}

import { QaError } from './api.js';

export function createMockQa() {
  const at = '2026-11-08T12:30:00Z';
  const records = [
    { id: 'mock-pending', question: '可以分享一下坚持记录的方法吗？', reply: null, status: 'pending', publishedAt: null, createdAt: at, updatedAt: at },
    { id: 'mock-published', question: '为什么想写下这 28 天？', reply: '想看看每天做一点小事，积累 28 天以后会是什么样。', status: 'published', publishedAt: at, createdAt: at, updatedAt: at },
    { id: 'mock-archived', question: '这是一条归档的演示问题。', reply: null, status: 'archived', publishedAt: null, createdAt: at, updatedAt: at },
  ];
  const page = (status, offset) => {
    const rows = records.filter((row) => row.status === status);
    return { questions: rows.slice(offset, offset + 20), nextOffset: offset + 20 < rows.length ? offset + 20 : null };
  };
  const verify = (token) => {
    if (token !== 'mock-session') throw new QaError('unauthorized', 401);
  };
  return {
    listQuestions: async (offset) => page('published', offset),
    async submitQuestion({ question, requestId }) {
      if (!records.some((row) => row.id === requestId)) {
        const now = new Date().toISOString();
        records.unshift({ id: requestId, question, reply: null, status: 'pending', publishedAt: null, createdAt: now, updatedAt: now });
      }
      return { ok: true };
    },
    signIn: async () => ({ token: 'mock-session', expiresAt: Date.now() + 60 * 60_000 }),
    signOut: async () => {},
    async listAdmin(status, offset, token) {
      verify(token);
      return page(status, offset);
    },
    async updateQuestion(id, { action, reply, updatedAt }, token) {
      verify(token);
      const row = records.find((item) => item.id === id);
      if (!row) throw new QaError('not_found', 404);
      if (row.updatedAt !== updatedAt) throw new QaError('conflict', 409);
      const now = new Date().toISOString();
      if (action === 'publish') Object.assign(row, { status: 'published', reply, publishedAt: row.publishedAt || now });
      else if (action === 'archive') row.status = 'archived';
      else Object.assign(row, { status: 'pending', publishedAt: null });
      row.updatedAt = now;
      return { question: row };
    },
  };
}

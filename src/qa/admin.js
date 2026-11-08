import { initSiteShell } from '../site-shell.js';
import { createQaClient, readQaConfig } from './api.js';
import { makeDate, makeElement, setCounter, setMessage } from './dom.js';

const REPLY_LIMIT = 2000;
const labels = { pending: '待处理', published: '已公开', archived: '已归档' };
const actionMessages = {
  publish: '回复已公开。', unpublish: '问答已撤下。', archive: '问题已归档。', restore: '问题已移回待处理。',
};

export function initAdminQa(root, { client }) {
  const document = root.ownerDocument;
  const loginForm = root.querySelector('[data-qa-login]');
  const emailInput = root.querySelector('[data-qa-email]');
  const passwordInput = root.querySelector('[data-qa-password]');
  const loginButton = root.querySelector('[data-qa-login-submit]');
  const loginMessage = root.querySelector('[data-qa-login-message]');
  const board = root.querySelector('[data-qa-board]');
  const list = root.querySelector('[data-qa-admin-questions]');
  const listMessage = root.querySelector('[data-qa-admin-message]');
  const more = root.querySelector('[data-qa-admin-more]');
  const reload = root.querySelector('[data-qa-admin-reload]');
  const tabs = [...root.querySelectorAll('[data-qa-status]')];
  let session;
  let expiryTimer;
  let status = 'pending';
  let nextOffset = null;
  let loading = false;
  let saving = false;
  let generation = 0;

  function syncControls() {
    more.disabled = loading || saving;
    reload.disabled = loading || saving;
    tabs.forEach((button) => {
      button.disabled = saving;
      button.setAttribute('aria-pressed', String(button.dataset.qaStatus === status));
    });
    list.querySelectorAll('[data-qa-action]').forEach((button) => { button.disabled = loading || saving; });
  }

  function signOutLocally(message, tone = '') {
    session = undefined;
    clearTimeout(expiryTimer);
    generation += 1;
    loading = false;
    saving = false;
    status = 'pending';
    nextOffset = null;
    list.replaceChildren();
    list.removeAttribute('aria-busy');
    board.hidden = true;
    loginForm.hidden = false;
    loginButton.disabled = false;
    setMessage(loginMessage, message, tone);
  }

  function handleSessionError(error) {
    if (error.code === 'unauthorized' || error.status === 401) {
      signOutLocally('登录已过期，请重新登录。', 'error');
      return true;
    }
    if (error.code === 'forbidden' || error.status === 403) {
      signOutLocally('此账号没有站主管理权限。', 'error');
      return true;
    }
    return false;
  }

  function renderQuestion(row) {
    const card = makeElement(document, 'article', 'qa-card qa-admin-card');
    card.dataset.questionId = row.id;
    card.append(
      makeElement(document, 'p', 'qa-kicker', labels[row.status]),
      makeElement(document, 'p', 'qa-copy qa-question-copy', row.question),
      makeDate(document, row.createdAt),
    );
    let replyInput;
    let countReply;
    if (row.status !== 'archived') {
      const label = makeElement(document, 'label', 'qa-label', '回复');
      replyInput = makeElement(document, 'textarea', 'qa-input qa-reply-input');
      replyInput.id = `qa-reply-${row.id}`;
      replyInput.rows = 4;
      replyInput.value = row.reply || '';
      label.htmlFor = replyInput.id;
      const counter = makeElement(document, 'span', 'qa-counter');
      countReply = setCounter(replyInput, counter, REPLY_LIMIT);
      card.append(label, replyInput, counter);
    } else if (row.reply) {
      card.append(makeElement(document, 'p', 'qa-reply-label', '原回复'), makeElement(document, 'p', 'qa-copy', row.reply));
    }
    const actions = makeElement(document, 'div', 'qa-actions');
    const message = makeElement(document, 'p', 'qa-message');
    message.setAttribute('role', 'status');
    function addAction(action, text, primary = false) {
      const button = makeElement(document, 'button', primary ? 'qa-button qa-button-primary' : 'qa-button', text);
      button.type = 'button';
      button.dataset.qaAction = action;
      button.addEventListener('click', () => {
        const body = { action, updatedAt: row.updatedAt };
        if (action === 'publish') {
          const count = countReply();
          if (count < 1 || count > REPLY_LIMIT) {
            setMessage(message, '请输入 1–2000 字的回复。', 'error');
            replyInput.focus();
            return;
          }
          body.reply = replyInput.value.trim();
        }
        void save(row, card, message, body);
      });
      actions.append(button);
    }
    if (row.status === 'pending') {
      addAction('publish', '回复并公开', true);
      addAction('archive', '归档');
    } else if (row.status === 'published') {
      addAction('publish', '更新回复', true);
      addAction('unpublish', '撤下');
    } else {
      addAction('restore', '恢复到待处理');
    }
    card.append(actions, message);
    return card;
  }

  function applyPage(result) {
    list.append(...result.questions.map(renderQuestion));
    nextOffset = result.nextOffset;
    more.hidden = nextOffset === null;
    more.textContent = '加载更多';
    setMessage(listMessage, list.children.length ? '' : `暂无${labels[status]}的问题。`);
  }

  async function loadPage(reset = false) {
    if (!session || saving || (loading && !reset)) return;
    if (reset) {
      generation += 1;
      list.replaceChildren();
      nextOffset = 0;
    }
    if (nextOffset === null) return;
    const requestGeneration = generation;
    loading = true;
    list.setAttribute('aria-busy', 'true');
    syncControls();
    setMessage(listMessage, '正在加载问题…');
    try {
      const result = await client.listAdmin(status, nextOffset, session.token);
      if (generation === requestGeneration) applyPage(result);
    } catch (error) {
      if (generation !== requestGeneration || handleSessionError(error)) return;
      setMessage(listMessage, '问题加载失败，请重试。', 'error');
      more.hidden = false;
      more.textContent = '重试加载';
    } finally {
      if (generation === requestGeneration) {
        loading = false;
        list.removeAttribute('aria-busy');
        syncControls();
      }
    }
  }

  async function save(row, card, message, body) {
    if (!session || loading || saving) return;
    const currentSession = session;
    saving = true;
    syncControls();
    setMessage(message, '正在保存…');
    try {
      const { question: updated } = await client.updateQuestion(row.id, body, currentSession.token);
      if (session !== currentSession) return;
      if (updated.status === status) card.replaceWith(renderQuestion(updated));
      else {
        card.remove();
        if (nextOffset !== null) nextOffset = Math.max(0, nextOffset - 1);
      }
      const suffix = list.children.length || nextOffset !== null ? '' : `暂无${labels[status]}的问题。`;
      setMessage(listMessage, `${actionMessages[body.action]}${suffix}`, 'success');
    } catch (error) {
      if (session !== currentSession || handleSessionError(error)) return;
      const text = error.code === 'conflict' || error.code === 'not_found'
        ? '问题已被更新，请刷新列表后重试。' : '暂时无法保存，请重试。';
      setMessage(message, text, 'error');
    } finally {
      if (session === currentSession) {
        saving = false;
        syncControls();
      }
    }
  }

  async function signIn(event) {
    event.preventDefault();
    if (!client || loginButton.disabled) return;
    loginButton.disabled = true;
    setMessage(loginMessage, '正在登录…');
    let candidate;
    try {
      candidate = await client.signIn(emailInput.value.trim(), passwordInput.value);
      const firstPage = await client.listAdmin('pending', 0, candidate.token);
      if (candidate.expiresAt <= Date.now()) throw new Error('expired');
      status = 'pending';
      applyPage(firstPage);
      session = candidate;
      expiryTimer = setTimeout(() => signOutLocally('登录已过期，请重新登录。', 'error'), candidate.expiresAt - Date.now());
      loginForm.hidden = true;
      board.hidden = false;
      setMessage(loginMessage, '');
      syncControls();
    } catch (error) {
      if (candidate) void client.signOut(candidate.token).catch(() => {});
      let message = '暂时无法登录，请稍后重试。';
      if (!candidate && [400, 401, 422].includes(error.status)) message = '邮箱或密码有误。';
      if (candidate && [401, 403].includes(error.status)) message = '此账号没有站主管理权限。';
      setMessage(loginMessage, message, 'error');
    } finally {
      passwordInput.value = '';
      loginButton.disabled = false;
    }
  }

  root.querySelector('[data-qa-sign-out]').addEventListener('click', async () => {
    if (!session) return;
    const { token } = session;
    signOutLocally('已退出管理。', 'success');
    const signedOutGeneration = generation;
    try { await client.signOut(token); }
    catch {
      if (generation === signedOutGeneration && !session && !loginButton.disabled) {
        setMessage(loginMessage, '已退出本页，服务器暂未确认登出。', 'error');
      }
    }
  });
  loginForm.addEventListener('submit', (event) => void signIn(event));
  more.addEventListener('click', () => void loadPage());
  reload.addEventListener('click', () => void loadPage(true));
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      if (!session || saving || tab.dataset.qaStatus === status) return;
      status = tab.dataset.qaStatus;
      void loadPage(true);
    });
  }
  loginForm.hidden = false;
  loginForm.querySelector('fieldset').disabled = !client;
  if (!client) setMessage(loginMessage, '问答管理暂未开放。');
}

async function start() {
  initSiteShell();
  const root = document.querySelector('[data-qa-admin]');
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('mock') === '1') {
    const { createMockQa } = await import('./mock.js');
    root.querySelector('[data-qa-demo]').hidden = false;
    document.querySelector('[data-qa-public-link]').href = '../?mock=1';
    initAdminQa(root, { client: createMockQa() });
    return;
  }
  const config = readQaConfig();
  initAdminQa(root, { client: config && createQaClient(config) });
}

if (typeof document !== 'undefined' && document.querySelector('[data-qa-admin]')) void start();

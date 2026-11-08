import { initSiteShell } from '../site-shell.js';
import { createQaClient, QaError, readQaConfig } from './api.js';
import { verifyCaptcha } from './captcha.js';
import { makeDate, makeElement, setCounter, setMessage } from './dom.js';

const QUESTION_LIMIT = 1000;
const submissionMessages = {
  invalid_input: '请输入 1–1000 字的问题。',
  captcha_failed: '人机验证未完成，请重试。草稿已保留。',
  rate_limited: '提交太频繁，请稍后再试。草稿已保留。',
};

export function initPublicQa(root, { client, verify, makeId = () => crypto.randomUUID() }) {
  const document = root.ownerDocument;
  const form = root.querySelector('[data-qa-form]');
  const questionInput = root.querySelector('[data-qa-question]');
  const send = root.querySelector('[data-qa-send]');
  const formMessage = root.querySelector('[data-qa-form-message]');
  const list = root.querySelector('[data-qa-questions]');
  const listMessage = root.querySelector('[data-qa-list-message]');
  const more = root.querySelector('[data-qa-more]');
  const updateCounter = setCounter(questionInput, root.querySelector('[data-qa-counter]'), QUESTION_LIMIT);
  const canSubmit = Boolean(client && verify);
  let nextOffset = 0;
  let loading = false;
  let sending = false;
  let draftAttempt;

  function renderQuestion(row) {
    const card = makeElement(document, 'article', 'qa-card qa-question-card');
    card.append(
      makeElement(document, 'p', 'qa-kicker', '匿名提问'),
      makeElement(document, 'p', 'qa-copy qa-question-copy', row.question),
      makeElement(document, 'p', 'qa-reply-label', '站主回复'),
      makeElement(document, 'p', 'qa-copy', row.reply),
      makeDate(document, row.publishedAt),
    );
    return card;
  }

  async function loadQuestions() {
    if (!client || loading || nextOffset === null) return;
    loading = true;
    more.disabled = true;
    list.setAttribute('aria-busy', 'true');
    setMessage(listMessage, '正在加载问答…');
    try {
      const result = await client.listQuestions(nextOffset);
      list.append(...result.questions.map(renderQuestion));
      nextOffset = result.nextOffset;
      more.hidden = nextOffset === null;
      more.textContent = '加载更多';
      setMessage(listMessage, list.children.length ? '' : '还没有公开的问答。');
    } catch {
      more.hidden = false;
      more.textContent = '重试加载';
      setMessage(listMessage, '问答暂时加载失败。', 'error');
    } finally {
      loading = false;
      more.disabled = false;
      list.removeAttribute('aria-busy');
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!canSubmit || sending) return;
    const question = questionInput.value.trim();
    const count = updateCounter();
    if (count < 1 || count > QUESTION_LIMIT) {
      setMessage(formMessage, submissionMessages.invalid_input, 'error');
      questionInput.focus();
      return;
    }
    sending = true;
    send.disabled = true;
    questionInput.readOnly = true;
    try {
      if (draftAttempt?.question !== question) draftAttempt = { question, requestId: makeId() };
      setMessage(formMessage, '正在进行人机验证…');
      const captchaToken = await verify();
      if (typeof captchaToken !== 'string' || !captchaToken) throw new QaError('captcha_failed');
      setMessage(formMessage, '正在提交…');
      const result = await client.submitQuestion({ ...draftAttempt, captchaToken });
      if (result?.ok !== true) throw new QaError('server_error');
      questionInput.value = '';
      draftAttempt = undefined;
      updateCounter();
      setMessage(formMessage, '问题已送出。审核并回复后，你可以在这里看到它。', 'success');
    } catch (error) {
      setMessage(formMessage, submissionMessages[error?.code] || '暂时无法提交，请稍后重试。草稿已保留。', 'error');
    } finally {
      sending = false;
      send.disabled = false;
      questionInput.readOnly = false;
    }
  }

  questionInput.addEventListener('input', () => {
    if (draftAttempt?.question !== questionInput.value.trim()) draftAttempt = undefined;
  });
  form.addEventListener('submit', (event) => void submit(event));
  more.addEventListener('click', () => void loadQuestions());
  form.querySelector('fieldset').disabled = !canSubmit;
  setMessage(formMessage, canSubmit ? '' : '匿名提问暂未开放。');
  if (!client) setMessage(listMessage, '问答暂未开放。');
  return loadQuestions();
}

async function start() {
  initSiteShell();
  const root = document.querySelector('[data-qa-public]');
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('mock') === '1') {
    const { createMockQa } = await import('./mock.js');
    root.querySelector('[data-qa-demo]').hidden = false;
    document.querySelector('[data-qa-admin-link]').href = './admin/?mock=1';
    await initPublicQa(root, { client: createMockQa(), verify: async () => 'mock-captcha' });
    return;
  }
  const config = readQaConfig();
  const client = config && createQaClient(config);
  const verify = config?.siteKey ? () => verifyCaptcha(root.querySelector('[data-qa-captcha]'), config.siteKey) : null;
  await initPublicQa(root, { client, verify });
}

if (typeof document !== 'undefined' && document.querySelector('[data-qa-public]')) void start();

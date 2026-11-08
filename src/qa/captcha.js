import { QaError } from './api.js';

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loadingScript;

function loadTurnstile(document) {
  const { defaultView: window } = document;
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loadingScript ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    function fail() {
      clearTimeout(timeout);
      script.remove();
      reject(new QaError('captcha_failed'));
    }
    const timeout = setTimeout(fail, 15_000);
    script.addEventListener('error', fail, { once: true });
    script.addEventListener('load', () => {
      if (!window.turnstile) return fail();
      clearTimeout(timeout);
      resolve(window.turnstile);
    }, { once: true });
    document.head.append(script);
  }).catch((error) => {
    loadingScript = undefined;
    throw error;
  });
  return loadingScript;
}

export async function verifyCaptcha(container, siteKey) {
  const turnstile = await loadTurnstile(container.ownerDocument);
  container.hidden = false;
  let widget;
  let timeout;
  try {
    return await new Promise((resolve, reject) => {
      const fail = () => reject(new QaError('captcha_failed'));
      timeout = setTimeout(fail, 120_000);
      widget = turnstile.render(container, {
        sitekey: siteKey,
        action: 'qa_submit',
        size: container.clientWidth < 300 ? 'compact' : 'flexible',
        theme: 'auto',
        callback: resolve,
        'error-callback': () => { fail(); return true; },
        'expired-callback': fail,
        'timeout-callback': fail,
      });
    });
  } catch {
    throw new QaError('captcha_failed');
  } finally {
    clearTimeout(timeout);
    if (widget != null) turnstile.remove(widget);
    container.hidden = true;
  }
}

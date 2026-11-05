import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { initCallScreen } from '../src/call-screen.js';
import { renderPage } from '../src/render-page.js';

test('120 screen preserves the day link and restores focus on arrow, Escape and history back', { timeout: 3000 }, async () => {
  const url = 'http://localhost:5173/weight-loss-project/#day-2';
  const window = new Window({ url });
  const document = window.document;
  document.body.innerHTML = renderPage();
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window, document });

  try {
    initCallScreen();
    const trigger = document.querySelector('[data-role="call-open"]');
    const screen = document.querySelector('[data-role="call-screen"]');
    const back = screen.querySelector('[data-role="call-back"]');
    assert.equal(trigger.getAttribute('aria-label'), '为zwh拨打120');
    assert.match(screen.textContent, /被 120 拉走也得把这 28 天扛完/);
    assert.equal(screen.open, false);

    const cancel = new window.Event('cancel', { cancelable: true });
    const closeActions = [
      () => back.click(),
      () => {
        screen.dispatchEvent(cancel);
        assert.equal(cancel.defaultPrevented, true);
      },
      () => window.history.back(),
    ];
    for (const close of closeActions) {
      trigger.focus();
      trigger.click();
      assert.equal(screen.open, true);
      assert.equal(document.activeElement, back);
      assert.equal(window.location.href, url);

      const navigation = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
      close();
      await navigation;
      assert.equal(screen.open, false);
      assert.equal(document.activeElement, trigger);
      assert.equal(window.location.href, url);
    }
  } finally {
    window.close();
    Object.assign(globalThis, previous);
  }
});

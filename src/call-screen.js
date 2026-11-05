const historyKey = 'challengeCallScreen';

export function initCallScreen() {
  const trigger = document.querySelector('[data-role="call-open"]');
  const screen = document.querySelector('[data-role="call-screen"]');
  const back = screen?.querySelector('[data-role="call-back"]');
  if (!trigger || !screen || !back) return;

  let returning = false;

  function syncScreen() {
    returning = false;
    if (window.history.state?.[historyKey]) {
      if (screen.open) return;
      screen.showModal();
      back.focus({ preventScroll: true });
    } else if (screen.open) {
      screen.close();
      trigger.focus({ preventScroll: true });
    }
  }

  function returnToPage() {
    if (returning) return;
    returning = true;
    window.history.back();
  }

  trigger.addEventListener('click', () => {
    if (screen.open) return;
    // The overlay gets a history entry at the same URL, including the day hash.
    window.history.pushState({ ...window.history.state, [historyKey]: true }, '');
    syncScreen();
  });
  back.addEventListener('click', returnToPage);
  screen.addEventListener('cancel', (event) => {
    event.preventDefault();
    returnToPage();
  });
  window.addEventListener('popstate', syncScreen);
  syncScreen();
}

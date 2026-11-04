import challenge from './data/challenge.json' with { type: 'json' };
import { getChallengeStatus } from './challenge-model.js';

const activeLogs = new WeakMap();

export function initChallengeLog() {
  const ledger = document.querySelector('.challenge-ledger');
  if (!ledger) return () => {};
  activeLogs.get(ledger)?.();

  const controller = new AbortController();
  const { signal } = controller;
  const root = document.documentElement;
  const switcher = document.querySelector('.challenge-view');
  const calendar = document.querySelector('.challenge-calendar');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let hashFrame;
  let manuallySelected = false;

  function setView(view) {
    if (view !== 'list' && view !== 'calendar') return;
    root.dataset.challengeView = view;
    switcher?.querySelectorAll('[data-view]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.view === view));
    });
  }

  function setExpanded(row, expanded) {
    const toggle = row?.querySelector('.challenge-row-toggle');
    if (!toggle) return;
    row.classList.toggle('challenge-row--collapsed', !expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
    const title = toggle.dataset[expanded ? 'collapse' : 'expand'];
    if (title) toggle.title = title;
  }

  function selectCalendarDay(day) {
    if (!calendar) return;
    day = String(day);
    const tiles = Array.from(calendar.querySelectorAll('button[data-select-day]'));
    if (!tiles.some((tile) => tile.dataset.selectDay === day)) return;
    tiles.forEach((tile) => {
      tile.setAttribute('aria-pressed', String(tile.dataset.selectDay === day));
    });
    calendar.querySelectorAll('[data-detail-day]').forEach((panel) => {
      panel.hidden = panel.dataset.detailDay !== day;
    });
  }

  function scrollTo(target, flash = false) {
    target.scrollIntoView({ block: 'start', behavior: reduced.matches ? 'auto' : 'smooth' });
    if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
    target.focus({ preventScroll: true });
    if (flash && target.classList.contains('challenge-row')) {
      target.classList.remove('challenge-row--flash');
      // Restart the source CSS animation when the same day is selected again.
      void target.offsetWidth;
      target.classList.add('challenge-row--flash');
    }
  }

  function revealDay(day, { flash = false, deferScroll = false } = {}) {
    day = String(day);
    const row = document.getElementById(`day-${day}`);
    const panel = calendar?.querySelector(`[data-detail-day="${day}"]`);
    const recordedRow = row && ledger.contains(row) ? row : null;
    const target = recordedRow || panel;
    if (!target) return;

    manuallySelected = true;
    selectCalendarDay(day);
    if (recordedRow) {
      setView('list');
      setExpanded(recordedRow, true);
    } else {
      setView('calendar');
    }
    cancelAnimationFrame(hashFrame);
    if (deferScroll) hashFrame = requestAnimationFrame(() => scrollTo(target, flash));
    else scrollTo(target, flash);
  }

  function openHash() {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    let id;
    try {
      id = decodeURIComponent(hash);
    } catch {
      return;
    }
    const dayMatch = /^day-([1-9]\d*)$/.exec(id);
    if (dayMatch) {
      revealDay(dayMatch[1], { deferScroll: true });
      return;
    }
    // Entry anchors still open their containing recorded day.
    const target = document.getElementById(hash) || document.getElementById(id);
    const row = target?.closest('.challenge-row');
    if (row && ledger.contains(row)) revealDay(row.id.slice(4), { deferScroll: true });
  }

  setView('list');
  // The list contains recorded days only; their logs are readable on arrival.
  ledger.querySelectorAll('.challenge-row').forEach((row) => setExpanded(row, true));
  selectCalendarDay(getChallengeStatus(challenge).clampedDay);

  switcher?.addEventListener('click', (event) => {
    const button = event.target instanceof Element && event.target.closest('[data-view]');
    if (button && switcher.contains(button)) setView(button.dataset.view);
  }, { signal });

  ledger.addEventListener('click', (event) => {
    const toggle = event.target instanceof Element && event.target.closest('.challenge-row-toggle');
    if (toggle && ledger.contains(toggle)) {
      setExpanded(toggle.closest('.challenge-row'), toggle.getAttribute('aria-expanded') !== 'true');
    }
  }, { signal });

  document.querySelector('.challenge-strip')?.addEventListener('click', (event) => {
    const button = event.target instanceof Element && event.target.closest('button[data-day]');
    if (button) revealDay(button.dataset.day, { flash: true });
  }, { signal });

  calendar?.addEventListener('click', (event) => {
    const tile = event.target instanceof Element && event.target.closest('button[data-select-day]');
    if (tile && calendar.contains(tile)) {
      manuallySelected = true;
      cancelAnimationFrame(hashFrame);
      selectCalendarDay(tile.dataset.selectDay);
    }
  }, { signal });

  document.addEventListener('challenge:day-change', (event) => {
    if (!manuallySelected) selectCalendarDay(event.detail.clampedDay);
  }, { signal });

  ledger.addEventListener('animationend', (event) => {
    event.target.classList?.remove('challenge-row--flash');
  }, { signal });
  window.addEventListener('hashchange', openHash, { signal });
  openHash();

  const cleanup = () => {
    controller.abort();
    cancelAnimationFrame(hashFrame);
    if (activeLogs.get(ledger) === cleanup) activeLogs.delete(ledger);
  };
  activeLogs.set(ledger, cleanup);
  return cleanup;
}

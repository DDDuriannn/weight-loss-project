import challenge from './data/challenge.json' with { type: 'json' };
import { getChallengeStatus } from './challenge-model.js';

const activeClocks = new WeakMap();

export function initChallengeClock() {
  const calendar = document.querySelector('[data-challenge-clock]');
  if (!calendar) return () => {};
  activeClocks.get(calendar)?.();

  const { locale = 'zh-CN' } = calendar.dataset;
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: challenge.timeZone,
  });
  const date = new Intl.DateTimeFormat(locale, {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: challenge.timeZone,
  });
  const field = (name) => calendar.querySelector(`[data-clock-${name}]`);
  let timer;
  let previousToday;

  function updateToday(status) {
    const containers = document.querySelectorAll(
      '.challenge-strip > [data-date], .challenge-month > [data-date], '
      + '.challenge-row[data-date], .challenge-detail[data-date]',
    );
    containers.forEach((element) => {
      const isToday = element.dataset.date === status.today;
      if (isToday) element.setAttribute('aria-current', 'date');
      else element.removeAttribute('aria-current');

      const heading = element.querySelector('.challenge-row-date, .challenge-detail-head');
      if (!heading) return;
      const marker = heading.querySelector('.challenge-detail-today');
      if (isToday && !marker) {
        const badge = document.createElement('span');
        badge.className = 'challenge-detail-today';
        badge.textContent = '今日';
        heading.append(badge);
      } else if (!isToday) marker?.remove();
    });
  }

  function progressText(status, progress) {
    if (status.phase === 'before') return progress?.dataset.before || '即将开始';
    if (status.phase === 'ended') return progress?.dataset.after || '挑战已结束';
    const template = progress?.dataset.dayLabel || '第 {day} 天 / 共 {total} 天';
    return template.replaceAll('{day}', String(status.day)).replaceAll('{total}', String(status.totalDays));
  }

  function tick() {
    clearTimeout(timer);
    const now = new Date();
    const status = getChallengeStatus(challenge, now);

    const timeField = field('time');
    if (timeField) {
      timeField.textContent = time.format(now);
      timeField.dateTime = now.toISOString();
    }
    const dateField = field('date');
    if (dateField) dateField.textContent = date.format(now);
    const dayField = field('day');
    if (dayField) dayField.textContent = String(status.clampedDay).padStart(2, '0');
    calendar.dataset.currentDay = String(status.day);

    const progress = document.querySelector('[data-challenge-progress]');
    const label = progressText(status, progress);
    const progressLabel = progress?.querySelector('[data-progress-label]');
    if (progressLabel) progressLabel.textContent = label;
    const note = calendar.querySelector('.challenge-calendar-note');
    if (note) note.textContent = label;

    if (previousToday !== status.today) {
      previousToday = status.today;
      updateToday(status);
      document.dispatchEvent(new window.CustomEvent('challenge:day-change', { detail: status }));
    }

    // Recalculate from the configured civil date each minute, including the
    // midnight boundary and visibility resumes, without a page reload.
    timer = setTimeout(tick, 60_000 - (now.getTime() % 60_000) + 50);
  }

  const onVisibilityChange = () => { if (!document.hidden) tick(); };
  document.addEventListener('visibilitychange', onVisibilityChange);
  tick();
  const cleanup = () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (activeClocks.get(calendar) === cleanup) activeClocks.delete(calendar);
  };
  activeClocks.set(calendar, cleanup);
  return cleanup;
}

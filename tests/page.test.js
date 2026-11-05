import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { buildDays, getChallengeStatus } from '../src/challenge-model.js';
import { loadChallenge, renderDocument, renderPage } from '../src/render-page.js';
import { initChallengeLog } from '../src/challenge-log.js';
import { initSiteShell } from '../src/site-shell.js';
import { initChallengeClock } from '../src/challenge-clock.js';

const firstEvening = '2026-11-04T13:17:00.000Z';
const texts = ['控制饮食：4 个鸡蛋 + 2 勺蛋白粉 + 一盘西葫芦', '运动：走路 + 跑步：10km', '运动：骑车 1.5 h'];
// Behavior fixtures stay stable while the published diary gains daily records.
const challenge = {
  title: '测试减肥大业', owner: '测试记录者', intro: '记录饮食与运动。',
  startDate: '2026-11-04', endDate: '2026-12-01', timeZone: 'Asia/Shanghai',
  records: [{
    date: '2026-11-04', weightKg: 101,
    entries: texts.map((text, index) => ({
      id: `fixture-entry-${index + 1}`, category: index === 0 ? 'diet' : 'exercise', text,
    })),
  }],
};

function environment(instant = firstEvening, hash = '', config = challenge) {
  const NativeDate = globalThis.Date;
  let currentInstant = instant;
  const window = new Window({ url: `http://localhost:5173/${hash}` });
  const document = window.document;
  document.write(`<html lang="zh-CN"><head><meta name="theme-color" content="#fff4dd"></head><body>${renderPage(config, new NativeDate(instant))}</body></html>`);
  const previous = new Map();
  for (const key of ['window', 'document', 'Element', 'Node', 'AbortController', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    previous.set(key, globalThis[key]);
    globalThis[key] = typeof window[key] === 'function' && key.endsWith('AnimationFrame') ? window[key].bind(window) : window[key];
  }
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [currentInstant])); }
    static now() { return NativeDate.parse(currentInstant); }
  };
  return {
    window, document,
    advanceTo: (value) => { currentInstant = value; },
    close: () => {
      window.happyDOM.abort(); window.close(); globalThis.Date = NativeDate;
      for (const [key, value] of previous) {
        if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
      }
    },
  };
}

test('published diary data remains valid as records, text, weights and media change', () => {
  const live = loadChallenge();
  assert.ok(typeof live.title === 'string' && live.title.trim());
  assert.ok(typeof live.owner === 'string' && live.owner.trim());
  const days = buildDays(live);
  const expectedDays = (Date.parse(`${live.endDate}T00:00:00Z`) - Date.parse(`${live.startDate}T00:00:00Z`)) / 86_400_000 + 1;
  assert.equal(days.length, expectedDays);
  assert.equal(days[0].date, live.startDate);
  assert.equal(days.at(-1).date, live.endDate);
  assert.equal(days.flatMap((day) => day.entries).length, live.records.flatMap((record) => record.entries || []).length);
  for (const record of live.records) {
    const day = days.find((item) => item.date === record.date);
    assert.ok(day, `Published record is outside the plan: ${record.date}`);
    assert.deepEqual(day.entries, record.entries || []);
    if (Object.hasOwn(record, 'weightKg')) assert.equal(day.weightKg, record.weightKg);
    if (Object.hasOwn(record, 'diary')) assert.equal(day.diary, record.diary);
  }
  assert.doesNotThrow(() => getChallengeStatus(live));
});

test('period fixture has 28 consecutive dates and categories are derived only from recorded content', () => {
  const days = buildDays(challenge);
  assert.equal(days.length, 28);
  assert.equal(days[0].date, '2026-11-04');
  assert.equal(days[0].dateLabel, '11月4日周三');
  assert.equal(days.at(-1).date, '2026-12-01');
  assert.equal(days.at(-1).dateLabel, '12月1日周二');
  assert.deepEqual(days[0].entries.map((entry) => entry.text), texts);
  assert.deepEqual(days[0].categories, ['exercise', 'diet']);
  assert.equal(days[0].state, 'mixed');
  assert.equal(days[0].weightKg, 101);
  assert.equal(days[0].hasWeight, true);
  assert.equal(days[0].hasEntries, true);
  assert.ok(days.slice(1).every((day) => day.state === 'empty' && !day.hasRecords));
});

test('daily weight accepts decimals and weight-only records without carrying values into unrecorded dates', () => {
  const config = structuredClone(challenge);
  config.records.push(
    { date: '2026-11-05', weightKg: 100.8 },
    { date: '2026-11-07', weightKg: 99.9, entries: [] },
  );
  const days = buildDays(config);
  assert.equal(days[0].weightKg, 101);
  for (const [index, weight] of [[1, 100.8], [3, 99.9]]) {
    assert.equal(days[index].weightKg, weight);
    assert.equal(days[index].hasWeight, true);
    assert.equal(days[index].hasEntries, false);
    assert.equal(days[index].hasRecords, true);
    assert.deepEqual(days[index].entries, []);
    assert.deepEqual(days[index].categories, []);
    assert.equal(days[index].state, 'empty');
  }
  for (const index of [2, 4, 27]) {
    assert.equal(days[index].hasWeight, false);
    assert.equal(days[index].weightKg, undefined);
    assert.equal(days[index].hasRecords, false);
  }

  delete config.records[0].weightKg;
  const withoutFirstWeight = buildDays(config);
  assert.equal(withoutFirstWeight[0].hasWeight, false);
  assert.equal(withoutFirstWeight[0].hasEntries, true);
  assert.equal(withoutFirstWeight[0].hasRecords, true);
  assert.equal(withoutFirstWeight[0].state, 'mixed');
});

test('a supplied weight must be a finite positive number; invalid values are never coerced or hidden', () => {
  for (const value of [null, undefined, '101', '', true, false, 0, -1, NaN, Infinity, -Infinity, {}, []]) {
    const config = structuredClone(challenge);
    config.records[0].weightKg = value;
    assert.throws(() => buildDays(config), `Expected invalid weight to be rejected: ${String(value)}`);
  }
});

test('diary-only dates render in both views without adding an activity', () => {
  const config = structuredClone(challenge);
  const diary = '第一行。\n记录 <em> 与 & 原样保留。';
  config.records.push({ date: '2026-11-05', diary });
  const [, recorded, empty] = buildDays(config);
  assert.equal(recorded.diary, diary);
  assert.equal(recorded.hasDiary, true);
  assert.equal(recorded.hasRecords, true);
  assert.equal(recorded.state, 'empty');
  assert.equal(empty.hasDiary, false);

  const env = environment(firstEvening, '', config);
  try {
    const { document } = env;
    const row = document.querySelector('#day-2');
    const panel = document.querySelector('[data-detail-day="2"]');
    for (const container of [row, panel]) {
      const content = container.querySelector('.challenge-diary-text');
      assert.equal(content.textContent, diary);
      assert.equal(content.querySelector('em'), null);
      assert.equal(container.querySelector('.challenge-diary-title').textContent, '日记');
      assert.equal(container.querySelector('article, .challenge-detail-entries'), null);
    }
    assert.equal(document.querySelector('[data-select-day="2"]').parentElement.querySelector('.challenge-tile-count'), null);
    assert.equal(panel.querySelector('.challenge-detail-empty').textContent, '暂无饮食与运动记录');
    assert.equal(document.querySelector('#day-3, [data-detail-day="3"] .challenge-diary'), null);
  } finally { env.close(); }
});

test('activity images render as local previews in the list and calendar with plain text titles', () => {
  const config = structuredClone(challenge);
  const entry = {
    id: 'fixture-strength', category: 'exercise', text: '力量训练 <原样> & 完成',
    image: { src: 'media/fixture-strength.jpg', alt: '力量训练 <记录> & "完成"' },
  };
  config.records.push({ date: '2026-11-05', entries: [entry] });
  const env = environment(firstEvening, '', config);
  try {
    const { document } = env;
    for (const [container, selector] of [
      [document.getElementById(entry.id), '.challenge-entry-title'],
      [document.querySelector(`[data-detail-day="2"] [data-entry-id="${entry.id}"]`), '.challenge-detail-title'],
    ]) {
      const title = container.querySelector(selector);
      assert.equal(title.textContent, entry.text);
      assert.equal(title.childElementCount, 0);
      const preview = container.querySelector('a.challenge-entry-media');
      const image = preview.querySelector('img');
      assert.equal(image.alt, entry.image.alt);
      assert.equal(image.src, new URL(entry.image.src, document.URL).href);
      assert.equal(preview.href, image.src);
      assert.equal(preview.target, '_blank');
      assert.ok(preview.relList.contains('noopener'));
    }
    assert.equal(document.querySelector('#day-1 .challenge-entry-media, [data-detail-day="1"] .challenge-entry-media'), null);
  } finally { env.close(); }
});

test('a supplied diary needs text and an activity image needs a safe local media path and alt text', () => {
  for (const diary of [null, 5, ' \n ']) {
    const config = structuredClone(challenge);
    config.records[0].diary = diary;
    assert.throws(() => buildDays(config));
  }
  for (const image of [
    null,
    { src: 'https://example.test/media/remote.jpg', alt: '外部图片' },
    { src: '/media/absolute.jpg', alt: '绝对路径' },
    { src: 'media/../outside.jpg', alt: '跨目录' },
    { src: 'media/active.svg', alt: '活动内容' },
    { src: 'media/fixture.jpg', alt: '  ' },
  ]) {
    const config = structuredClone(challenge);
    config.records[0].entries[0].image = image;
    assert.throws(() => buildDays(config));
  }
});

test('day calculation uses Beijing midnight and includes the entire final day', () => {
  for (const [instant, day, phase, clampedDay] of [
    ['2026-11-03T15:59:59Z', 0, 'before', 1],
    ['2026-11-03T16:00:00Z', 1, 'active', 1],
    ['2026-11-04T15:59:59Z', 1, 'active', 1],
    ['2026-11-04T16:00:00Z', 2, 'active', 2],
    ['2026-12-01T15:59:59Z', 28, 'active', 28],
    ['2026-12-01T16:00:00Z', 29, 'ended', 28],
  ]) {
    const result = getChallengeStatus(challenge, new Date(instant));
    assert.deepEqual([result.day, result.phase, result.clampedDay, result.totalDays], [day, phase, clampedDay, 28], instant);
  }
});

test('personal page has one readable record day, all 28 dates and no old identity or external links', () => {
  const env = environment();
  try {
    const { document } = env;
    assert.equal(document.querySelector('.masthead-title').textContent.trim(), challenge.title);
    assert.equal(document.querySelector('.masthead-emoji').textContent, '🤡');
    assert.equal(document.querySelectorAll('.masthead button').length, 2);
    assert.ok(document.querySelector('.masthead button[data-role="call-open"]'));
    assert.ok(document.querySelector('.masthead button[data-role="theme-toggle"]'));
    assert.ok(document.querySelector('dialog[data-role="call-screen"]'));
    assert.equal(document.querySelectorAll('.challenge-row').length, 1);
    assert.equal(document.querySelector('.challenge-row').id, 'day-1');
    assert.equal(document.querySelectorAll('article').length, 3);
    assert.deepEqual([...document.querySelectorAll('.challenge-entry-title')].map((node) => node.textContent), texts);
    assert.equal(document.querySelectorAll('.challenge-strip button').length, 28);
    assert.equal(document.querySelectorAll('[data-select-day]').length, 28);
    assert.equal(document.querySelectorAll('[data-detail-day]').length, 28);
    assert.equal(document.querySelectorAll('a, iframe, script, .language-toggle, .challenge-votes, .masthead-presence').length, 0);
    assert.equal(document.querySelectorAll('img').length, 1);
    assert.equal(document.querySelector('.challenge-promise img.challenge-intro-gif').getAttribute('src'), '/media/intro.gif');
    assert.doesNotMatch(document.body.innerHTML, /Tibo|Codex|thsottiaux|产品改进|储备重置|美西|https?:|undefined|<!--\s*CHALLENGE_/);
    assert.match(document.querySelector('.challenge-period').textContent, /2026\.11\.04 — 2026\.12\.01 · 共 28 天/);
  } finally { env.close(); }
});

test('calendar is weekday-aligned with two leading and five trailing empty cells', () => {
  const env = environment();
  try {
    const cells = [...env.document.querySelector('.challenge-month').children];
    assert.equal(cells.length, 35);
    assert.ok(cells.slice(0, 2).every((cell) => cell.classList.contains('challenge-calendar-spacer')));
    assert.equal(cells[2].querySelector('button').dataset.selectDay, '1');
    assert.equal(cells[29].querySelector('button').dataset.selectDay, '28');
    assert.ok(cells.slice(30).every((cell) => cell.getAttribute('aria-hidden') === 'true'));
  } finally { env.close(); }
});

test('weight appears once per recorded row and every calendar day, with explicit missing values', () => {
  const env = environment();
  try {
    const { document } = env;
    assert.equal(document.querySelectorAll('.challenge-weight').length, 29);
    for (const component of document.querySelectorAll('#day-1 .challenge-weight, [data-detail-day="1"] .challenge-weight')) {
      assert.equal(component.dataset.date, '2026-11-04');
      assert.equal(component.dataset.weightKg, '101');
      assert.equal(component.querySelector('.challenge-weight-label').textContent, '体重');
      assert.equal(component.querySelector('.challenge-weight-value').textContent, '101');
      assert.equal(component.querySelector('.challenge-weight-unit').textContent, 'kg');
    }
    assert.equal(document.querySelectorAll('#day-1 .challenge-row-date .challenge-weight').length, 1);
    for (const panel of document.querySelectorAll('[data-detail-day]')) {
      const component = panel.querySelector('.challenge-weight');
      assert.ok(component, `Missing weight display for day ${panel.dataset.detailDay}`);
      assert.equal(component.dataset.date, panel.dataset.date);
      if (panel.dataset.detailDay === '1') continue;
      assert.equal(component.hasAttribute('data-weight-kg'), false);
      assert.equal(component.querySelector('.challenge-weight-empty').textContent, '体重未记录');
      assert.equal(component.querySelector('.challenge-weight-value, .challenge-weight-unit'), null);
    }
    assert.equal(document.querySelector('[data-select-day="1"]').parentElement.querySelector('.challenge-tile-count').textContent, '3');
    assert.equal(document.querySelectorAll('article').length, 3);
  } finally { env.close(); }
});

test('weight-only dates remain neutral in list and calendar and do not add activity counts or invented trends', () => {
  const config = structuredClone(challenge);
  config.records.push({ date: '2026-11-05', weightKg: 100.8 });
  const env = environment(firstEvening, '', config);
  const cleanup = initChallengeLog();
  try {
    const { document } = env;
    assert.deepEqual([...document.querySelectorAll('.challenge-row')].map((row) => row.id), ['day-2', 'day-1']);
    const row = document.querySelector('#day-2');
    const panel = document.querySelector('[data-detail-day="2"]');
    const tile = document.querySelector('[data-select-day="2"]').parentElement;
    assert.equal(document.querySelectorAll('article').length, 3);
    assert.equal(tile.querySelector('.challenge-tile-count'), null);
    assert.equal(panel.querySelectorAll('.challenge-detail-entries li').length, 0);
    assert.equal(panel.querySelector('.challenge-detail-empty').textContent, '暂无饮食与运动记录');
    for (const component of [row.querySelector('.challenge-weight'), panel.querySelector('.challenge-weight')]) {
      assert.equal(component.dataset.weightKg, '100.8');
      assert.equal(component.querySelector('.challenge-weight-value').textContent, '100.8');
    }
    for (const item of [tile, panel, document.querySelector('.challenge-strip [data-day="2"]').parentElement]) {
      assert.ok(item.classList.contains('challenge-state--empty'));
      assert.doesNotMatch(item.className, /challenge-state--(?:exercise|diet|mixed)/);
    }
    assert.equal(row.querySelector('.challenge-group, .challenge-badge, article'), null);
    assert.ok(document.querySelector('[data-select-day="1"]').parentElement.classList.contains('challenge-state--mixed'));
    assert.deepEqual([...document.querySelectorAll('#day-1 .challenge-group')].map((group) => group.className), [
      'challenge-group challenge-state--diet', 'challenge-group challenge-state--exercise',
    ]);

    row.querySelector('.challenge-row-toggle').click();
    assert.ok(row.classList.contains('challenge-row--collapsed'));
    assert.equal(row.querySelector('.challenge-row-date .challenge-weight-value').textContent, '100.8');
    document.querySelector('[data-view="calendar"]').click();
    document.querySelector('[data-select-day="2"]').click();
    assert.equal(panel.hidden, false);
    assert.equal(panel.querySelector('.challenge-weight-value').textContent, '100.8');
    document.querySelector('[data-select-day="3"]').click();
    assert.equal(document.querySelector('[data-detail-day="3"] .challenge-weight-empty').textContent, '体重未记录');
    assert.equal(document.querySelector('[data-detail-day="3"] [data-weight-kg]'), null);
    assert.doesNotMatch(document.body.innerHTML, /challenge-weight-(?:trend|chart|delta|change|target)|体重趋势|累计减重|较昨日|已减重|减重目标|[-−]0\.2\s*(?:kg|公斤)/i);
  } finally { cleanup(); env.close(); }
});

test('weight-only dates support recorded-day deep links, disclosure and strip navigation', () => {
  const config = structuredClone(challenge);
  config.records.push({ date: '2026-11-05', weightKg: 100.8, entries: [] });
  const env = environment(firstEvening, '#day-2', config);
  const cleanup = initChallengeLog();
  try {
    const { document } = env;
    const row = document.querySelector('#day-2');
    const toggle = row.querySelector('.challenge-row-toggle');
    assert.equal(document.documentElement.dataset.challengeView, 'list');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(document.querySelector('[data-select-day][aria-pressed="true"]').dataset.selectDay, '2');
    toggle.click();
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    document.querySelector('.challenge-strip [data-day="2"]').click();
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(document.documentElement.dataset.challengeView, 'list');
    assert.equal(document.activeElement, row);
    assert.ok(row.classList.contains('challenge-row--flash'));
  } finally { cleanup(); env.close(); }
});

test('document title and description follow the same configuration as the visible page', () => {
  const config = { ...challenge, title: '新的项目名', owner: '记录者', startDate: '2026-11-05', endDate: '2026-12-02', records: [] };
  const html = renderDocument(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), config, new Date(firstEvening));
  assert.match(html, /<title>新的项目名 · 28 天减肥计划<\/title>/);
  assert.match(html, /记录者 的 28 天减肥记录，2026-11-05 至 2026-12-02/);
  assert.match(html, /2026\.11\.05 — 2026\.12\.02/);
  assert.doesNotMatch(html, /\{\{(?:documentTitle|documentDescription|calendarLabel)\}\}/);
});

test('new recorded days derive their categories and appear newest first without empty list cards', () => {
  const config = structuredClone(challenge);
  config.records.push({ date: '2026-11-06', entries: [{ id: 'day-3-walk', category: 'exercise', text: '运动：走路' }] });
  const days = buildDays(config);
  assert.equal(days[2].state, 'exercise');
  const env = environment(firstEvening, '', config);
  try {
    assert.deepEqual([...env.document.querySelectorAll('.challenge-row')].map((row) => row.id), ['day-3', 'day-1']);
    assert.equal(env.document.querySelectorAll('article').length, 4);
  } finally { env.close(); }
});

test('record day is expanded by default and repeated init does not duplicate disclosure events', () => {
  const env = environment();
  const first = initChallengeLog();
  const cleanup = initChallengeLog();
  try {
    const toggle = env.document.querySelector('#day-1 .challenge-row-toggle');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(env.document.querySelectorAll('.challenge-row--collapsed').length, 0);
    toggle.click();
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    toggle.click();
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  } finally { cleanup(); first(); env.close(); }
});

test('calendar initially selects today and preserves all three first-day entries', () => {
  const env = environment();
  const cleanup = initChallengeLog();
  try {
    assert.equal(env.document.querySelector('[data-select-day="1"]').getAttribute('aria-pressed'), 'true');
    env.document.querySelector('[data-view="calendar"]').click();
    assert.equal(env.document.documentElement.dataset.challengeView, 'calendar');
    assert.equal(env.document.querySelector('[data-detail-day="1"]').hidden, false);
    assert.equal(env.document.querySelectorAll('[data-detail-day="1"] li').length, 3);
    env.document.querySelector('[data-select-day="2"]').click();
    assert.equal(env.document.querySelector('[data-detail-day="2"]').hidden, false);
    assert.equal(env.document.querySelector('[data-detail-day="2"] .challenge-detail-empty').textContent, '暂无记录');
    assert.equal(env.document.querySelectorAll('.challenge-detail:not([hidden])').length, 1);
  } finally { cleanup(); env.close(); }
});

test('date strip routes empty days to the calendar and recorded days back to the list', () => {
  const env = environment();
  const cleanup = initChallengeLog();
  try {
    const panel = env.document.querySelector('[data-detail-day="28"]');
    let scrolled = false;
    panel.scrollIntoView = () => { scrolled = true; };
    env.document.querySelector('.challenge-strip [data-day="28"]').click();
    assert.equal(env.document.documentElement.dataset.challengeView, 'calendar');
    assert.equal(panel.hidden, false);
    assert.equal(env.document.activeElement, panel);
    assert.equal(scrolled, true);
    env.document.querySelector('.challenge-strip [data-day="1"]').click();
    assert.equal(env.document.documentElement.dataset.challengeView, 'list');
    assert.equal(env.document.querySelector('#day-1').classList.contains('challenge-row--flash'), true);
  } finally { cleanup(); env.close(); }
});

test('recorded and empty day deep links resolve on load; invalid hashes are harmless', () => {
  for (const [hash, view, selected] of [['#day-1', 'list', '1'], ['#day-12', 'calendar', '12'], ['#day-28', 'calendar', '28']]) {
    const env = environment(firstEvening, hash);
    const cleanup = initChallengeLog();
    try {
      assert.equal(env.document.documentElement.dataset.challengeView, view);
      assert.equal(env.document.querySelector('[data-select-day][aria-pressed="true"]').dataset.selectDay, selected);
      for (const invalid of ['#day-999', '#missing', '#%E0%A4%A']) {
        env.window.history.replaceState(null, '', invalid);
        assert.doesNotThrow(() => env.window.dispatchEvent(new env.window.HashChangeEvent('hashchange')));
      }
    } finally { cleanup(); env.close(); }
  }
});

test('clock crosses midnight without reloading and moves today markers and untouched calendar selection', () => {
  const env = environment('2026-11-04T15:59:00Z');
  const logCleanup = initChallengeLog();
  const clockCleanup = initChallengeClock();
  try {
    assert.equal(env.document.querySelector('[data-clock-time]').textContent, '23:59');
    assert.equal(env.document.querySelectorAll('.challenge-month [aria-current="date"]').length, 1);
    env.advanceTo('2026-11-04T16:00:00Z');
    env.document.dispatchEvent(new env.window.Event('visibilitychange'));
    assert.equal(env.document.querySelector('[data-clock-time]').textContent, '00:00');
    assert.equal(env.document.querySelector('[data-clock-day]').textContent, '02');
    assert.equal(env.document.querySelector('[data-progress-label]').textContent, '第 2 天 / 共 28 天');
    assert.equal(env.document.querySelector('.challenge-calendar-note').textContent, '第 2 天 / 共 28 天');
    assert.equal(env.document.querySelector('[data-select-day="2"]').getAttribute('aria-pressed'), 'true');
    assert.equal(env.document.querySelector('.challenge-month [aria-current="date"] button').dataset.selectDay, '2');
    assert.equal(env.document.querySelector('#day-1 .challenge-detail-today'), null);
    assert.ok(env.document.querySelector('[data-detail-day="2"] .challenge-detail-today'));
  } finally { clockCleanup(); logCleanup(); env.close(); }
});

test('manual calendar selection survives a midnight clock update', () => {
  const env = environment('2026-11-04T15:59:00Z');
  const logCleanup = initChallengeLog();
  const clockCleanup = initChallengeClock();
  try {
    env.document.querySelector('[data-select-day="3"]').click();
    env.advanceTo('2026-11-04T16:00:00Z');
    env.document.dispatchEvent(new env.window.Event('visibilitychange'));
    assert.equal(env.document.querySelector('[data-select-day][aria-pressed="true"]').dataset.selectDay, '3');
  } finally { clockCleanup(); logCleanup(); env.close(); }
});

test('before, final-day and ended states choose the right calendar day and status label', () => {
  for (const [instant, selected, label] of [
    ['2026-11-03T15:59:00Z', '1', '即将开始'],
    ['2026-12-01T15:59:00Z', '28', '第 28 天 / 共 28 天'],
    ['2026-12-01T16:00:00Z', '28', '挑战已结束'],
  ]) {
    const env = environment(instant);
    const logCleanup = initChallengeLog();
    const clockCleanup = initChallengeClock();
    try {
      assert.equal(env.document.querySelector('[data-select-day][aria-pressed="true"]').dataset.selectDay, selected);
      assert.equal(env.document.querySelector('[data-progress-label]').textContent, label);
      assert.equal(env.document.querySelector('.challenge-calendar-note').textContent, label);
    } finally { clockCleanup(); logCleanup(); env.close(); }
  }
});

test('single theme control remembers its preference; blocked storage still permits switching', () => {
  const env = environment();
  env.window.localStorage.setItem('loser-weightloss-theme', 'light');
  let cleanup = initSiteShell();
  try {
    const button = env.document.querySelector('[data-role="theme-toggle"]');
    button.click();
    assert.equal(env.document.documentElement.dataset.theme, 'dark');
    assert.equal(env.window.localStorage.getItem('loser-weightloss-theme'), 'dark');
    cleanup(); cleanup = initSiteShell();
    assert.equal(env.document.documentElement.dataset.theme, 'dark');
    env.window.localStorage.setItem = () => { throw new Error('Storage blocked'); };
    assert.doesNotThrow(() => button.click());
    assert.equal(env.document.documentElement.dataset.theme, 'light');
  } finally { cleanup(); env.close(); }
});

test('runtime and document entry contain no old identity, external URLs or backend requests', () => {
  for (const name of ['main', 'site-shell', 'challenge-log', 'challenge-clock', 'challenge-model']) {
    const source = readFileSync(new URL(`../src/${name}.js`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\bfetch\s*\(|new\s+(?:WebSocket|XMLHttpRequest)|\/api\/|https?:\/\/|Tibo|Codex|codex-resets/);
  }
  assert.doesNotMatch(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /Tibo|Codex|codex-resets|https?:\/\//);
});

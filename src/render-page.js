import { readFileSync } from 'node:fs';
import { buildDays, CATEGORY_LABELS, getChallengeStatus } from './challenge-model.js';

const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

export function loadChallenge() {
  return JSON.parse(readFileSync(new URL('./data/challenge.json', import.meta.url), 'utf8'));
}

const current = (day, status) => day.date === status.today ? ' aria-current="date"' : '';
const todayBadge = (day, status) => day.date === status.today ? '<span class="challenge-detail-today">今日</span>' : '';

function renderWeight(day) {
  if (!day.hasWeight) {
    return `<div class="challenge-weight challenge-weight--empty" data-date="${day.date}"><span class="challenge-weight-empty">体重未记录</span></div>`;
  }
  return `<div class="challenge-weight" data-date="${day.date}" data-weight-kg="${day.weightKg}" role="group" aria-label="体重 ${day.weightKg} kg"><span class="challenge-weight-label">体重</span><span class="challenge-weight-value">${day.weightKg}</span><span class="challenge-weight-unit">kg</span></div>`;
}

function renderImage(entry) {
  if (!entry.image) return '';
  const src = escape(entry.image.src);
  const alt = escape(entry.image.alt);
  return `<a class="challenge-entry-media" href="./${src}" target="_blank" rel="noopener noreferrer" aria-label="${alt}（新标签页查看大图）"><img src="/${src}" alt="${alt}" loading="lazy" decoding="async" /></a>`;
}

function renderDiary(day) {
  if (!day.hasDiary) return '';
  return `<section class="challenge-diary" aria-label="日记"><strong class="challenge-diary-title">日记</strong><p class="challenge-diary-text">${escape(day.diary)}</p></section>`;
}

function renderStrip(day, status) {
  return `<li class="challenge-cell challenge-state--${day.state}" data-date="${day.date}" title="${escape(day.summary)}"${current(day, status)}><span class="challenge-cell-day" aria-hidden="true">${day.day}</span><button type="button" data-day="${day.day}" aria-label="${escape(day.accessibleLabel)}"></button><span class="visually-hidden challenge-cell-summary">${escape(day.accessibleLabel)}</span></li>`;
}

function renderTile(day, status) {
  return `<li class="challenge-tile ${day.hasRecords ? 'challenge-tile--kept' : 'challenge-tile--empty'} challenge-state--${day.state}" data-date="${day.date}"${current(day, status)}><button type="button" data-select-day="${day.day}" aria-pressed="${day.day === status.clampedDay}" aria-controls="challenge-detail-${day.day}" aria-label="${escape(day.accessibleLabel)}"><span class="challenge-tile-number">${day.day}</span><span class="challenge-tile-date">${escape(day.shortDate)}</span>${day.entries.length > 1 ? `<span class="challenge-tile-count">${day.entries.length}</span>` : ''}</button></li>`;
}

function renderDetail(day, status) {
  const body = day.hasEntries ? `<ul class="challenge-detail-entries">${day.entries.map((entry) => `<li class="challenge-state--${entry.category}" data-entry-id="${escape(entry.id)}"><div class="challenge-detail-entry-content"><span class="visually-hidden">${CATEGORY_LABELS[entry.category]}: </span><span class="challenge-detail-title">${escape(entry.text)}</span>${renderImage(entry)}</div></li>`).join('')}</ul>` : `<p class="challenge-detail-empty">${day.hasRecords ? '暂无饮食与运动记录' : '暂无记录'}</p>`;
  return `<section class="challenge-detail ${day.hasRecords ? 'challenge-detail--kept' : 'challenge-detail--empty'} challenge-state--${day.state}" id="challenge-detail-${day.day}" data-detail-day="${day.day}" data-date="${day.date}" tabindex="-1" aria-labelledby="challenge-detail-${day.day}-title"${current(day, status)}${day.day === status.clampedDay ? '' : ' hidden'}><header class="challenge-detail-head"><h3 id="challenge-detail-${day.day}-title">${day.label}</h3><time datetime="${day.date}">${escape(day.dateLabel)}</time>${todayBadge(day, status)}</header>${renderWeight(day)}${body}${renderDiary(day)}</section>`;
}

function renderRow(day, status) {
  // Retain the supplied order: the first category is diet, followed by exercise.
  const categories = [...new Set(day.entries.map((entry) => entry.category))];
  const groups = categories.map((category) => {
    const entries = day.entries.filter((entry) => entry.category === category).map((entry) => `<article id="${escape(entry.id)}" class="challenge-entry challenge-entry--${category}"><h3 class="challenge-entry-title">${escape(entry.text)}</h3>${renderImage(entry)}</article>`).join('');
    return `<div class="challenge-group challenge-state--${category}"><span class="challenge-badge challenge-state--${category}">${CATEGORY_LABELS[category]}</span>${entries}</div>`;
  }).join('');
  return `<li class="challenge-row challenge-row--kept challenge-row--foldable" id="day-${day.day}" data-date="${day.date}" tabindex="-1"${current(day, status)}><button type="button" class="challenge-row-toggle" aria-expanded="true" aria-controls="day-${day.day}-body" aria-label="${day.label}" title="收起详情" data-expand="展开详情" data-collapse="收起详情"><span class="challenge-row-toggle-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span></button><div class="challenge-row-date"><span>${day.label}</span><time datetime="${day.date}">${escape(day.dateLabel)}</time>${todayBadge(day, status)}${renderWeight(day)}</div><div class="challenge-row-body" id="day-${day.day}-body">${groups || '<p class="challenge-row-note">暂无饮食与运动记录</p>'}${renderDiary(day)}</div></li>`;
}

/** Pre-render complete HTML; only the live clock and navigation need client JS. */
export function renderPage(config = loadChallenge(), now = new Date()) {
  const days = buildDays(config);
  const status = getChallengeStatus(config, now);
  const leading = (new Date(`${config.startDate}T00:00:00Z`).getUTCDay() + 6) % 7;
  const trailing = (7 - (leading + days.length) % 7) % 7;
  const spacer = '<li class="challenge-calendar-spacer" aria-hidden="true"></li>';
  const progress = status.phase === 'before' ? '即将开始' : status.phase === 'ended' ? '挑战已结束' : `第 ${status.day} 天 / 共 ${status.totalDays} 天`;
  const format = (options) => new Intl.DateTimeFormat('zh-CN', { ...options, timeZone: config.timeZone }).format(now);
  const values = {
    BRAND: escape(config.title), OWNER: escape(config.owner), INTRO: escape(config.intro),
    PERIOD: `${config.startDate.replaceAll('-', '.')} — ${config.endDate.replaceAll('-', '.')} · 共 ${status.totalDays} 天`,
    TODAY: format({ month: 'long', day: 'numeric', weekday: 'short' }),
    DAY: String(status.clampedDay).padStart(2, '0'), PROGRESS: progress,
    TIME: format({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    CHALLENGE_STRIP: days.map((day) => renderStrip(day, status)).join(''),
    CHALLENGE_MONTH: spacer.repeat(leading) + days.map((day) => renderTile(day, status)).join('') + spacer.repeat(trailing),
    CHALLENGE_DETAILS: days.map((day) => renderDetail(day, status)).join(''),
    CHALLENGE_LEDGER: [...days].reverse().filter((day) => day.hasRecords).map((day) => renderRow(day, status)).join(''),
  };
  return readFileSync(new URL('./page.html', import.meta.url), 'utf8')
    .replace(/<!--\s*([A-Z_]+)\s*-->/g, (match, name) => values[name] ?? match)
    .replaceAll('{{startDate}}', config.startDate)
    .replaceAll('{{totalDays}}', String(status.totalDays))
    .replaceAll('{{calendarLabel}}', `${config.startDate} 至 ${config.endDate} 日历`)
    .replaceAll('{{now}}', now.toISOString());
}

export function renderDocument(html, config = loadChallenge(), now = new Date()) {
  const { totalDays } = getChallengeStatus(config, now);
  return html.replace('<!-- PAGE -->', renderPage(config, now))
    .replaceAll('{{documentTitle}}', escape(`${config.title} · ${totalDays} 天减肥计划`))
    .replaceAll('{{documentDescription}}', escape(`${config.owner} 的 ${totalDays} 天减肥记录，${config.startDate} 至 ${config.endDate}。${config.intro}`));
}

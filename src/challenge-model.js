const DAY_MS = 86_400_000;
const MEDIA_PATH = /^media\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(?:jpe?g|png|webp)$/;
export const CATEGORY_LABELS = { exercise: '运动', diet: '饮食' };

function dateTime(date) {
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(timestamp)
      || new Date(timestamp).toISOString().slice(0, 10) !== date) {
    throw new Error(`日期无效：${date}`);
  }
  return timestamp;
}

function range(config) {
  const start = dateTime(config.startDate);
  const totalDays = Math.round((dateTime(config.endDate) - start) / DAY_MS) + 1;
  if (totalDays < 1) throw new Error('结束日期不能早于开始日期');
  return { start, totalDays };
}

export function getChallengeStatus(config, now = new Date()) {
  const { start, totalDays } = range(config);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const day = Math.round((dateTime(today) - start) / DAY_MS) + 1;
  return {
    today, day, totalDays,
    clampedDay: Math.min(totalDays, Math.max(1, day)),
    phase: day < 1 ? 'before' : day > totalDays ? 'ended' : 'active',
  };
}

/** Derive every date and category summary from the fixed period and actual records. */
export function buildDays(config) {
  const { start, totalDays } = range(config);
  const byDate = new Map();
  const ids = new Set();
  for (const record of config.records) {
    const timestamp = dateTime(record.date);
    if (timestamp < start || timestamp >= start + totalDays * DAY_MS || byDate.has(record.date)) {
      throw new Error(`记录日期重复或超出周期：${record.date}`);
    }
    const entries = record.entries === undefined ? [] : record.entries;
    if (!Array.isArray(entries)) throw new Error(`记录条目必须是数组：${record.date}`);
    if (Object.hasOwn(record, 'weightKg')
        && (typeof record.weightKg !== 'number' || !Number.isFinite(record.weightKg) || record.weightKg <= 0)) {
      throw new Error(`体重必须是大于零的有限数字：${record.date}`);
    }
    if (Object.hasOwn(record, 'diary') && (typeof record.diary !== 'string' || !record.diary.trim())) {
      throw new Error(`日记必须是非空文本：${record.date}`);
    }
    for (const entry of entries) {
      if (!Object.hasOwn(CATEGORY_LABELS, entry.category) || !entry.text?.trim() || !entry.id || ids.has(entry.id)) {
        throw new Error(`记录内容或类别无效：${entry.id}`);
      }
      if (Object.hasOwn(entry, 'image')) {
        const { image } = entry;
        if (typeof image?.src !== 'string' || !MEDIA_PATH.test(image.src)
            || typeof image.alt !== 'string' || !image.alt.trim()) {
          throw new Error(`记录图片需要 media/ 内的本地路径和替代文本：${entry.id}`);
        }
      }
      ids.add(entry.id);
    }
    byDate.set(record.date, { entries, weightKg: record.weightKg, diary: record.diary });
  }
  const dateLabel = new Intl.DateTimeFormat('zh-CN', {
    month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC',
  });
  return Array.from({ length: totalDays }, (_, index) => {
    const instant = new Date(start + index * DAY_MS);
    const date = instant.toISOString().slice(0, 10);
    const record = byDate.get(date);
    const entries = record?.entries || [];
    const weightKg = record?.weightKg;
    const diary = record?.diary;
    const hasWeight = weightKg !== undefined;
    const hasEntries = entries.length > 0;
    const hasDiary = diary !== undefined;
    const categories = Object.keys(CATEGORY_LABELS).filter((kind) => entries.some((entry) => entry.category === kind));
    const label = `第 ${String(index + 1).padStart(2, '0')} 天`;
    const displayDate = dateLabel.format(instant);
    const summary = categories.length ? categories.map((kind) => CATEGORY_LABELS[kind]).join(' + ')
      : hasWeight ? '已记录体重' : hasDiary ? '已记录日记' : '暂无记录';
    const weightLabel = hasWeight ? `体重 ${weightKg} kg` : '体重未记录';
    return {
      day: index + 1, date, label, dateLabel: displayDate,
      shortDate: `${instant.getUTCMonth() + 1}/${instant.getUTCDate()}`,
      entries, categories, weightKg, diary, hasWeight, hasEntries, hasDiary,
      hasRecords: hasWeight || hasEntries || hasDiary,
      state: categories.length > 1 ? 'mixed' : categories[0] || 'empty',
      summary: `${label} · ${displayDate} · ${summary}`,
      accessibleLabel: `${label}, ${displayDate}: ${summary}；${weightLabel}`,
    };
  });
}

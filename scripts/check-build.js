import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const data = JSON.parse(await readFile(new URL('../src/data/challenge.json', import.meta.url), 'utf8'));
const start = Date.parse(`${data.startDate}T00:00:00Z`);
const dayCount = (Date.parse(`${data.endDate}T00:00:00Z`) - start) / 86400000 + 1;
const days = Array.from({ length: dayCount }, (_, index) => index + 1);
const hasWeight = (record) => record && Object.hasOwn(record, 'weightKg');
for (const record of data.records) {
  if (hasWeight(record)) {
    assert.equal(typeof record.weightKg, 'number', `Weight must be numeric: ${record.date}`);
    assert.ok(Number.isFinite(record.weightKg) && record.weightKg > 0, `Weight must be finite and positive: ${record.date}`);
  }
}
const records = data.records.filter((record) => hasWeight(record) || (record.entries?.length || 0) > 0);
const entries = records.flatMap((record) => record.entries || []);
const recordsByDate = new Map(data.records.map((record) => [record.date, record]));
const recordedDays = records.map((record) => (Date.parse(`${record.date}T00:00:00Z`) - start) / 86400000 + 1);
const leadingBlanks = (new Date(start).getUTCDay() + 6) % 7;
const trailingBlanks = (7 - (leadingBlanks + dayCount) % 7) % 7;
const basePath = '/replica/';
const mimeTypes = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.json': 'application/json',
};

// Serve only the repository subpath, without an SPA fallback.
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!pathname.startsWith(basePath)) {
      response.writeHead(404).end();
      return;
    }
    const file = resolve(dist, pathname.slice(basePath.length) || 'index.html');
    const fromDist = relative(dist, file);
    if (isAbsolute(fromDist) || fromDist === '..' || fromDist.startsWith(`..${sep}`)) {
      response.writeHead(404).end();
      return;
    }
    const bytes = await readFile(file);
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(file)] || 'application/octet-stream' });
    response.end(bytes);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 500).end();
  }
});

server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const home = new URL(basePath, origin);
const loaded = new Map();
let parsedWindow;

async function load(reference, parent = home) {
  const url = new URL(reference, parent);
  assert.equal(url.origin, origin, `External resource: ${reference}`);
  assert.ok(url.pathname.startsWith(basePath), `Resource escaped ${basePath}: ${reference}`);
  if (loaded.has(url.href)) return loaded.get(url.href);

  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, `Missing resource: ${url.pathname}`);
  const extension = extname(url.pathname) || '.html';
  const expectedType = mimeTypes[extension];
  assert.ok(expectedType, `Unrecognized resource type: ${url.pathname}`);
  assert.equal(response.headers.get('content-type')?.split(';')[0], expectedType, url.pathname);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length > 0, `Empty resource: ${url.pathname}`);
  if (extension === '.woff2') assert.equal(bytes.toString('ascii', 0, 4), 'wOF2', url.pathname);
  if (extension === '.css' || extension === '.js') {
    assert.doesNotMatch(bytes.toString('utf8'), /^\s*<(?:!doctype|html)/i, url.pathname);
  }
  const resource = { url, extension, text: bytes.toString('utf8') };
  loaded.set(url.href, resource);
  return resource;
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)]
    .map((match) => [match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]]));
}

function checkCode(text, label) {
  assert.doesNotMatch(text, /(?:https?:|wss?:)\/\/|\/api\/|WebSocket|XMLHttpRequest|sendBeacon/i,
    `${label} contains an external URL or a removed backend integration`);
}

const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

function dayAttributes(html, name) {
  return [...html.matchAll(new RegExp(`\\b${name}="(\\d+)"`, 'g'))].map((match) => Number(match[1]));
}

function checkWeight(component, date) {
  assert.ok(component, `Missing weight display: ${date}`);
  assert.equal(component.dataset.date, date, 'Weight display is attached to the wrong date');
  const record = recordsByDate.get(date);
  if (hasWeight(record)) {
    assert.equal(component.dataset.weightKg, String(record.weightKg), `Incorrect weight attribute: ${date}`);
    assert.equal(component.querySelector('.challenge-weight-label')?.textContent, '体重', date);
    assert.equal(component.querySelector('.challenge-weight-value')?.textContent, String(record.weightKg), `Incorrect visible weight: ${date}`);
    assert.equal(component.querySelector('.challenge-weight-unit')?.textContent, 'kg', `Incorrect weight unit: ${date}`);
    assert.equal(component.querySelector('.challenge-weight-empty'), null, `Recorded weight shown as missing: ${date}`);
  } else {
    assert.equal(component.hasAttribute('data-weight-kg'), false, `Invented weight: ${date}`);
    assert.equal(component.querySelector('.challenge-weight-empty')?.textContent, '体重未记录', date);
    assert.equal(component.querySelector('.challenge-weight-value, .challenge-weight-unit'), null, `Unrecorded weight has a value: ${date}`);
  }
}

try {
  // Root-relative assets must really fail rather than accidentally pass this check.
  assert.equal((await fetch(new URL('/fonts/Baloo2-Bold.woff2', origin))).status, 404);
  const { text: html } = await load(home);
  assert.match(html, /<html\b[^>]*lang="zh-CN"/i);
  assert.doesNotMatch(html, /<!--\s*[A-Z_]+\s*-->|\{\{[\s\S]*?\}\}|__[A-Z][A-Z0-9_]*__|%[A-Z][A-Z0-9_]*%/,
    'Unresolved build placeholder in HTML');
  assert.doesNotMatch(html, /<(?:base|iframe|object|embed|img)\b/i, 'Unexpected embedded document, base URL or image avatar');
  assert.doesNotMatch(html, /Tibo|Codex|OpenAI|thsottiaux|codex-resets|America\/Los_Angeles|language-(?:menu|toggle)|x-link|data-(?:vote|presence)|challenge-vote|\/api\//i,
    'Old site branding or integrations remain in HTML');

  assert.equal(dayCount, 28, 'Expected a 28-day plan');
  assert.equal(data.timeZone, 'Asia/Shanghai', 'Expected Beijing time');
  assert.ok(html.includes(escape(data.title)), 'Project title is missing');
  assert.ok(html.includes(escape(data.owner)), 'Record owner is missing');
  assert.ok(html.includes(`data-start="${data.startDate}"`), 'Plan start date is missing');
  assert.ok(html.includes('北京时间'), 'Beijing clock label is missing');
  assert.ok(html.includes(`datetime="${data.endDate}"`), 'Plan end date is missing');
  const dayIds = [...html.matchAll(/\bid="day-(\d+)"/g)].map((match) => Number(match[1]));
  assert.deepEqual(dayIds.sort((a, b) => a - b), [...recordedDays].sort((a, b) => a - b),
    'List rows must contain exactly the recorded dates');
  const rowToggles = [...html.matchAll(/<button\b[^>]*>/gi)]
    .map((match) => attributes(match[0]))
    .filter((attrs) => attrs.class?.split(/\s+/).includes('challenge-row-toggle'));
  assert.equal(rowToggles.length, records.length, 'Each recorded date needs a row toggle');
  assert.ok(rowToggles.every((attrs) => attrs['aria-expanded'] === 'true'), 'Recorded rows must start expanded');
  const articles = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)];
  assert.equal(articles.length, entries.length, 'Article count does not match recorded entries');
  for (const article of articles) {
    assert.match(article[1], /<h3\b[^>]*>[^<]+<\/h3>/i, 'Entry titles must be plain text');
    assert.doesNotMatch(article[1], /<a\b/i, 'Record titles must not be links');
  }
  for (const entry of entries) assert.ok(html.includes(escape(entry.text)), `Missing record: ${entry.id}`);

  // Parse the published HTML independently of the model and renderer. Resources
  // are loaded explicitly below, so parsing must never execute the application.
  parsedWindow = new Window({
    url: home.href,
    settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
  });
  parsedWindow.document.write(html);
  const document = parsedWindow.document;
  assert.equal(document.querySelectorAll('.challenge-weight').length, dayCount + records.length,
    'Expected one weight display per recorded row and calendar panel');
  for (const record of records) {
    const day = (Date.parse(`${record.date}T00:00:00Z`) - start) / 86400000 + 1;
    const components = document.querySelectorAll(`#day-${day} .challenge-row-date .challenge-weight`);
    assert.equal(components.length, 1, `Each recorded row needs exactly one weight display: ${record.date}`);
    checkWeight(components[0], record.date);
  }
  for (const day of days) {
    const date = new Date(start + (day - 1) * 86400000).toISOString().slice(0, 10);
    const components = document.querySelectorAll(`[data-detail-day="${day}"] .challenge-weight`);
    assert.equal(components.length, 1, `Each calendar panel needs exactly one weight display: ${date}`);
    checkWeight(components[0], date);
  }
  assert.deepEqual(dayAttributes(html, 'data-day'), days, 'Date strip must include all 28 days');
  assert.deepEqual(dayAttributes(html, 'data-select-day'), days, 'Calendar must include all 28 date tiles');
  assert.deepEqual(dayAttributes(html, 'data-detail-day'), days, 'Calendar must include all 28 detail panels');
  const month = html.match(/<ol\b[^>]*class="[^"]*\bchallenge-month\b[^"]*"[^>]*>([\s\S]*?)<\/ol>/i);
  assert.ok(month, 'Calendar grid is missing');
  const calendarCells = [...month[1].matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/gi)]
    .map((match) => dayAttributes(match[0], 'data-select-day')[0] ?? null);
  assert.deepEqual(calendarCells, [
    ...Array(leadingBlanks).fill(null), ...days, ...Array(trailingBlanks).fill(null),
  ], 'Calendar weekday alignment is incorrect');
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = attributes(match[0]).href;
    if (!href) continue;
    const url = new URL(href, home);
    assert.equal(url.origin, origin, `Unexpected external link: ${href}`);
    assert.ok(url.pathname.startsWith(basePath), `Link escaped the repository subpath: ${href}`);
  }

  for (const match of html.matchAll(/<(script|link|img|source|video|audio)\b[^>]*>/gi)) {
    const tag = match[1].toLowerCase();
    const attrs = attributes(match[0]);
    const references = [attrs.src, attrs.poster];
    if (attrs.srcset) references.push(...attrs.srcset.split(',').map((item) => item.trim().split(/\s+/)[0]));
    if (tag === 'link' && !/^(?:canonical|alternate)$/i.test(attrs.rel || '')) references.push(attrs.href);
    for (const reference of references.filter(Boolean)) await load(reference);
  }
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) checkCode(match[1], 'Inline script');

  const styles = [...loaded.values()].filter((resource) => resource.extension === '.css');
  const scripts = [...loaded.values()].filter((resource) => resource.extension === '.js');
  assert.ok(styles.length > 0, 'Stylesheet was not loaded');
  assert.ok(scripts.length > 0, 'Application script was not loaded');
  assert.ok(scripts.some((script) => script.text.includes(data.timeZone)), 'Configured time zone is missing from the application');
  for (const script of scripts) checkCode(script.text, script.url.pathname);

  const fonts = new Set();
  for (const style of styles) {
    assert.doesNotMatch(style.text, /@import\b/i, 'Unexpected CSS import; all styles must be bundled');
    for (const match of style.text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi)) {
      const asset = await load(match[1] ?? match[2] ?? match[3], style.url);
      if (asset.extension === '.woff2') fonts.add(asset.url.pathname.split('/').pop());
    }
  }
  assert.deepEqual([...fonts].sort(), [
    'Baloo2-Bold.woff2', 'Baloo2-ExtraBold.woff2',
    'GenSenRounded-Bold-UI.woff2', 'GenSenRounded-Heavy-UI.woff2',
  ].sort(), 'Expected all four local fonts');
  assert.equal(loaded.size, 7, 'Expected only HTML, JavaScript, CSS and four fonts');

  console.log(`Build check passed: ${basePath}, ${dayCount} days, ${records.length} recorded row, ${articles.length} articles, ${document.querySelectorAll('.challenge-weight').length} verified weight displays, 28 tiles/panels, ${leadingBlanks}/${trailingBlanks} calendar blanks, ${loaded.size} HTTP 200 resources (${scripts.length} script, ${styles.length} stylesheet, ${fonts.size} fonts).`);
  console.log('All resources stay under the repository subpath; no unresolved placeholders or external loading integrations found.');
} finally {
  if (parsedWindow) { await parsedWindow.happyDOM.abort(); parsedWindow.close(); }
  server.closeAllConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
}

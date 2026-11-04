const THEME_STORAGE_KEY = 'loser-weightloss-theme';
const THEME_COLORS = { light: '#fff4dd', dark: '#17130f' };
let cleanupShell;

function readPreference() {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch { return null; }
}

export function initSiteShell() {
  cleanupShell?.();
  const controller = new AbortController();
  const { signal } = controller;
  const root = document.documentElement;
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = readPreference();

  function applyTheme(theme) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
    const button = document.querySelector('[data-role="theme-toggle"]');
    if (button) {
      const label = `切换到${theme === 'dark' ? '浅色' : '深色'}模式`;
      button.setAttribute('aria-pressed', String(theme === 'dark'));
      button.setAttribute('aria-label', label);
      button.title = label;
    }
  }
  const systemPreference = () => systemTheme.matches ? 'dark' : 'light';
  applyTheme(preference || systemPreference());
  root.classList.add('theme-controls-enabled');

  document.querySelector('[data-role="theme-toggle"]')?.addEventListener('click', () => {
    preference = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { window.localStorage.setItem(THEME_STORAGE_KEY, preference); } catch {}
    applyTheme(preference);
  }, { signal });
  systemTheme.addEventListener('change', () => {
    if (!preference) applyTheme(systemPreference());
  }, { signal });
  window.addEventListener('storage', (event) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    preference = readPreference();
    applyTheme(preference || systemPreference());
  }, { signal });

  cleanupShell = () => controller.abort();
  return cleanupShell;
}

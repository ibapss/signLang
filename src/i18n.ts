import strings from './i18n/strings.json';

export type Lang = 'en' | 'ur';
type Entry = { en: string; ur: string; reviewed: boolean };
const table = strings as unknown as Record<string, Entry | string>;

let current: Lang = 'en';
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

/** Look up a UI string and fill {placeholders}. Falls back to English, then to the key. */
export function t(key: string, vars: Record<string, string | number> = {}, lang: Lang = current): string {
  const e = table[key];
  let s = typeof e === 'object' ? (e[lang] ?? e.en) : key;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function setLang(lang: Lang): void {
  current = lang;
  const html = document.documentElement;
  html.lang = lang;
  html.dir = lang === 'ur' ? 'rtl' : 'ltr';
  try {
    localStorage.setItem('ui-lang', lang);
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((fn) => fn());
}

export function initLang(): void {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem('ui-lang');
  } catch {
    saved = null;
  }
  setLang(saved === 'ur' ? 'ur' : 'en');
}

export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Re-translate every element carrying data-i18n (text) or data-i18n-aria (aria-label). */
export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n!);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria!));
  });
}

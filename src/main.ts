import '@fontsource/noto-nastaliq-urdu/arabic-400.css';
import '@fontsource/noto-nastaliq-urdu/arabic-700.css';
import './styles.css';
import { detectCapabilities } from './env';
import { applyI18n, getLang, initLang, onLangChange, setLang, t } from './i18n';
import { parseRoute, type Route } from './router';
import { loadSettings } from './settings';
import { TranslatePage } from './pages/translate';
import { registerServiceWorker } from './pwa';

const caps = detectCapabilities();
const settings = loadSettings();
const view = document.getElementById('view')!;
let translate: TranslatePage | null = null;
let route: Route | null = null;

function renderPlaceholder(r: Route): void {
  view.innerHTML = `<section class="placeholder"><h2></h2><p></p></section>`;
  view.querySelector('h2')!.textContent = t(`nav.${r}`);
  view.querySelector('p')!.textContent = t('page.notBuilt');
}

function render(): void {
  const next = parseRoute(location.hash);
  if (next === route) return;
  if (route === 'translate') {
    translate?.unmount();
    translate = null;
  }
  route = next;
  document.querySelectorAll<HTMLAnchorElement>('nav a').forEach((a) => {
    if (a.dataset.route === next) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (next === 'translate') {
    translate = new TranslatePage(caps, settings);
    translate.mount(view);
  } else {
    renderPlaceholder(next);
  }
  document.title = `${t(`nav.${next}`)} · ${t('app.title')}`;
}

const langBtn = document.getElementById('langBtn')!;
function syncLangButton(): void {
  // The button names the *other* language, written in that language.
  langBtn.lang = getLang() === 'en' ? 'ur' : 'en';
}

initLang();
applyI18n();
syncLangButton();
onLangChange(() => {
  applyI18n();
  syncLangButton();
  translate?.relabel();
  if (route && route !== 'translate') renderPlaceholder(route);
  if (route) document.title = `${t(`nav.${route}`)} · ${t('app.title')}`;
});
langBtn.addEventListener('click', () => setLang(getLang() === 'en' ? 'ur' : 'en'));
window.addEventListener('hashchange', render);
render();
if (import.meta.env.PROD) registerServiceWorker();

// Exposed for end-to-end tests and for reading numbers off real phones.
(window as unknown as { __psl: unknown }).__psl = {
  diagnostics: () => translate?.diagnostics() ?? null,
  lastFrame: () => translate?.lastFrameSummary() ?? null,
};

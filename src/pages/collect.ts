import type { Capabilities } from '../env';
import { applyI18n, getLang, t } from '../i18n';
import { LiveView } from '../live';
import type { Settings } from '../settings';
import signsData from '../data/signs.json';
import { FEATURE_VERSION, type RawFrame } from '../features/features';
import { MEDIAPIPE_VERSION } from '../landmarks/detector';
import {
  buildPlan,
  exportSession,
  randomSignerCode,
  takeQuality,
  type Prompt,
  type SignerInfo,
  type Take,
} from '../collect/plan';

const RECORD_MS = 2500;
const COUNTDOWN_S = 3;
const DICT_BASE = 'https://github.com/sign-language-translator/sign-language-datasets/releases/download/v0.0.2/';

type SignItem = { id: string; gloss: string; en: string; ur: string; ref: string };
const SIGNS = (signsData as { items: SignItem[] }).items;
const byGloss = new Map(SIGNS.map((s) => [s.gloss, s]));

const SLOT = `
<section class="collect">
  <div id="setup" class="panel">
    <h2 data-i18n="collect.title"></h2>
    <p data-i18n="collect.intro"></p>
    <form id="setupForm">
      <label class="check"><input type="checkbox" id="consent" required> <span data-i18n="collect.consent"></span></label>
      <label class="field"><span data-i18n="collect.code"></span>
        <input id="code" required pattern="[A-Za-z0-9-]{3,16}" autocomplete="off" lang="en" dir="ltr"></label>
      <fieldset class="field"><legend data-i18n="collect.hand"></legend>
        <label><input type="radio" name="hand" value="right" checked> <span data-i18n="collect.right"></span></label>
        <label><input type="radio" name="hand" value="left"> <span data-i18n="collect.left"></span></label>
      </fieldset>
      <label class="field"><span data-i18n="collect.psl"></span>
        <select id="psl">
          <option value="deaf" data-i18n="collect.psl.deaf"></option>
          <option value="fluent" data-i18n="collect.psl.fluent"></option>
          <option value="learner" data-i18n="collect.psl.learner"></option>
        </select></label>
      <label class="field"><span data-i18n="collect.reps"></span>
        <input id="reps" type="number" min="1" max="10" value="5" lang="en" dir="ltr"></label>
      <button class="btn primary big" type="submit" data-i18n="collect.begin"></button>
    </form>
  </div>
  <div id="session" hidden>
    <p class="muted" data-i18n="collect.howto"></p>
    <div class="prompt-card" id="card" aria-live="polite">
      <div class="prompt-gloss" id="pGloss"></div>
      <div class="prompt-en" id="pEn" lang="en" dir="ltr"></div>
      <div class="prompt-ur" id="pUr" lang="ur" dir="rtl"></div>
      <a id="pRef" target="_blank" rel="noopener" hidden>Reference video (PSL dictionary, CC BY 4.0)</a>
      <div class="countdown" id="countdown" aria-live="assertive"></div>
    </div>
    <div class="controls">
      <button class="btn primary big" id="recBtn" data-i18n="collect.recordBtn"></button>
      <button class="btn" id="redoBtn" data-i18n="collect.redo" disabled></button>
      <button class="btn" id="skipBtn" data-i18n="collect.skip"></button>
    </div>
    <p id="status" role="status" aria-live="polite"></p>
    <p class="muted" id="progressLine"></p>
    <div class="controls">
      <button class="btn" id="exportBtn" disabled></button>
    </div>
    <p class="muted" data-i18n="collect.keepTab"></p>
  </div>
</section>`;

export class CollectPage {
  readonly live: LiveView;
  private plan: Prompt[] = [];
  private index = 0;
  private takes: Take[] = [];
  private signer: SignerInfo | null = null;
  private consentAt = '';
  private sessionId = '';
  private busy = false;

  constructor(caps: Capabilities, settings: Settings) {
    this.live = new LiveView(caps, settings);
  }

  mount(host: HTMLElement): void {
    this.live.mount(host);
    const slot = this.live.slot;
    slot.innerHTML = SLOT;
    applyI18n(slot);
    (slot.querySelector('#code') as HTMLInputElement).value = randomSignerCode();
    slot.querySelector('#setupForm')!.addEventListener('submit', (e) => {
      e.preventDefault();
      this.begin();
    });
    this.q('recBtn').addEventListener('click', () => void this.record());
    this.q('redoBtn').addEventListener('click', () => this.redo());
    this.q('skipBtn').addEventListener('click', () => this.advance());
    this.q('exportBtn').addEventListener('click', () => this.download());
    this.renderExport();
  }

  unmount(): void {
    this.live.unmount();
  }

  relabel(): void {
    this.live.relabel();
    applyI18n(this.live.slot);
    this.renderPrompt();
    this.renderExport();
  }

  private q(id: string): HTMLElement {
    return this.live.slot.querySelector(`#${id}`)!;
  }

  private begin(): void {
    const slot = this.live.slot;
    const code = (slot.querySelector('#code') as HTMLInputElement).value.trim().toUpperCase();
    const hand = (slot.querySelector('input[name=hand]:checked') as HTMLInputElement).value as SignerInfo['handedness'];
    const psl = (slot.querySelector('#psl') as HTMLSelectElement).value as SignerInfo['psl'];
    const reps = Math.min(10, Math.max(1, Number((slot.querySelector('#reps') as HTMLInputElement).value) || 5));
    this.signer = { code, handedness: hand, psl };
    this.consentAt = new Date().toISOString();
    const seed = Math.floor(Math.random() * 2 ** 31);
    this.sessionId = `${code}-${Date.now().toString(36)}`;
    this.plan = buildPlan(SIGNS.map((s) => s.gloss), reps, seed);
    this.index = 0;
    this.takes = [];
    this.q('setup').hidden = true;
    this.q('session').hidden = false;
    this.renderPrompt();
    this.renderExport();
  }

  private current(): Prompt | null {
    return this.plan[this.index] ?? null;
  }

  private renderPrompt(): void {
    if (this.q('session').hidden) return;
    const p = this.current();
    const gloss = this.q('pGloss');
    const en = this.q('pEn');
    const ur = this.q('pUr');
    const ref = this.q('pRef') as HTMLAnchorElement;
    this.q('progressLine').textContent = t('collect.progress', { done: this.index, total: this.plan.length });
    if (!p) {
      gloss.textContent = '✓';
      en.textContent = t('collect.done', {}, 'en');
      ur.textContent = t('collect.done', {}, 'ur');
      ref.hidden = true;
      (this.q('recBtn') as HTMLButtonElement).disabled = true;
      (this.q('skipBtn') as HTMLButtonElement).disabled = true;
      return;
    }
    (this.q('recBtn') as HTMLButtonElement).disabled = false;
    (this.q('skipBtn') as HTMLButtonElement).disabled = false;
    if (p.kind === 'none') {
      gloss.textContent = '—';
      en.textContent = t(`collect.none.${p.noneKind}`, {}, 'en');
      ur.textContent = t(`collect.none.${p.noneKind}`, {}, 'ur');
      ref.hidden = true;
    } else {
      const s = byGloss.get(p.label)!;
      gloss.textContent = s.gloss;
      en.textContent = s.en;
      ur.textContent = s.ur;
      ref.href = `${DICT_BASE}${encodeURIComponent(s.ref)}.mp4`;
      ref.hidden = false;
    }
  }

  private renderExport(): void {
    const b = this.q('exportBtn') as HTMLButtonElement;
    b.textContent = t('collect.export', { n: this.takes.length });
    b.disabled = this.takes.length === 0;
  }

  private status(msg: string): void {
    this.q('status').textContent = msg;
  }

  private async record(): Promise<void> {
    const p = this.current();
    if (!p || this.busy) return;
    if (!this.live.running) return this.status(t('collect.needCamera'));
    this.busy = true;
    const rec = this.q('recBtn') as HTMLButtonElement;
    rec.disabled = true;
    const cd = this.q('countdown');
    for (let i = COUNTDOWN_S; i > 0; i--) {
      cd.textContent = String(i);
      await sleep(1000);
    }
    cd.textContent = '●';
    this.q('card').classList.add('recording');
    this.status(t('collect.recording'));
    const frames: RawFrame[] = [];
    const startT = performance.now();
    const endT = startT + RECORD_MS;
    const off = this.live.onFrame((raw) => {
      if (raw.t >= startT && raw.t <= endT) frames.push(raw);
    });
    await sleep(RECORD_MS + 100);
    off();
    this.q('card').classList.remove('recording');
    cd.textContent = '';
    const take: Take = { id: `${this.sessionId}-${this.takes.length + 1}`, prompt: p, startT, endT, frames };
    const quality = takeQuality(take);
    this.busy = false;
    rec.disabled = false;
    if (!quality.ok) {
      this.status(t('collect.noHands'));
      return;
    }
    this.takes.push(take);
    (this.q('redoBtn') as HTMLButtonElement).disabled = false;
    this.status(t('collect.saved', { pct: Math.round(quality.handFraction * 100) }));
    this.advance();
    this.renderExport();
  }

  private advance(): void {
    if (this.index < this.plan.length) this.index++;
    this.renderPrompt();
  }

  private redo(): void {
    const last = this.takes.pop();
    if (!last) return;
    // Put the prompt back in front of the current one.
    this.index = Math.max(0, this.index - 1);
    this.plan[this.index] = last.prompt;
    (this.q('redoBtn') as HTMLButtonElement).disabled = this.takes.length === 0;
    this.renderPrompt();
    this.renderExport();
  }

  private download(): void {
    if (!this.signer || this.takes.length === 0) return;
    const d = this.live.diagnostics();
    const data = exportSession(
      this.signer,
      {
        appVersion: __APP_VERSION__,
        featureVersion: FEATURE_VERSION,
        mediapipe: MEDIAPIPE_VERSION,
        detector: String(d.landmarks ?? ''),
        delegate: (d.delegate as string | null) ?? null,
        camera: String(d.camera ?? ''),
        consentText: t('collect.consent', {}, getLang()),
        consentAt: this.consentAt,
        sessionId: this.sessionId,
      },
      this.takes,
    );
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `psl-collect-${this.signer.code}-${new Date().toISOString().slice(0, 10)}-${this.takes.length}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

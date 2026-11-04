import type { Capabilities } from '../env';
import { applyI18n, t } from '../i18n';
import { LiveView } from '../live';
import type { Settings } from '../settings';

const SLOT = `
<div class="outputs">
  <section class="panel" aria-labelledby="enHead">
    <h2 id="enHead" data-i18n="out.en"></h2>
    <p class="out out-en" id="outEn" lang="en" dir="ltr" aria-live="polite"></p>
  </section>
  <section class="panel" aria-labelledby="urHead">
    <h2 id="urHead" data-i18n="out.ur"></h2>
    <p class="out out-ur" id="outUr" lang="ur" dir="rtl" aria-live="polite"></p>
  </section>
</div>`;

export class TranslatePage {
  readonly live: LiveView;

  constructor(caps: Capabilities, settings: Settings) {
    this.live = new LiveView(caps, settings);
    this.live.extraDiagnostics = () => ({
      classifierMs: 'n/a (no classifier yet)',
      modelVersion: 'n/a (no classifier yet)',
      top3: 'n/a (no classifier yet)',
    });
  }

  mount(host: HTMLElement): void {
    this.live.mount(host);
    this.live.slot.innerHTML = SLOT;
    applyI18n(this.live.slot);
    this.renderOutputs();
  }

  unmount(): void {
    this.live.unmount();
  }

  relabel(): void {
    this.live.relabel();
    this.renderOutputs();
  }

  private renderOutputs(): void {
    // Panels are fixed to their own language, whatever the interface language is.
    this.live.slot.querySelector('#outEn')!.textContent = t('out.pending', {}, 'en');
    this.live.slot.querySelector('#outUr')!.textContent = t('out.pending', {}, 'ur');
  }
}

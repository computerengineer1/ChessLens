/** One-time fair-play notice shown on first launch. */

import { el } from './dom.js';
import { t } from './i18n.js';
import type { Screen } from './screens.js';

export class FairPlayScreen implements Screen {
  readonly id = 'fairplay';
  readonly root: HTMLElement;
  private titleEl: HTMLElement;
  private bodyEl: HTMLElement;
  private acceptBtn: HTMLButtonElement;

  constructor(private onAccept: () => void) {
    this.titleEl = el('h1', { class: 'fairplay-title', text: t('fairplay.title') });
    this.bodyEl = el('p', { class: 'fairplay-body', text: t('fairplay.body') });
    this.acceptBtn = el('button', { class: 'btn btn-primary btn-big', text: t('fairplay.accept') });
    this.acceptBtn.addEventListener('click', () => this.onAccept());
    this.root = el('div', { class: 'screen-content fairplay-screen' }, [
      el('div', { class: 'fairplay-logo', text: '\u265e' }),
      this.titleEl,
      this.bodyEl,
      el('p', { class: 'fairplay-tagline', text: t('app.tagline') }),
      this.acceptBtn
    ]);
  }

  refreshI18n(): void {
    this.titleEl.textContent = t('fairplay.title');
    this.bodyEl.textContent = t('fairplay.body');
    this.acceptBtn.textContent = t('fairplay.accept');
  }
}

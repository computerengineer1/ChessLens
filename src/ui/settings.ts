/** Settings drawer/screen: engine, assist side, language, vision thresholds. */

import type { AppSettings, AssistSide } from '../types.js';
import { el, sliderRow } from './dom.js';
import { t, setLang } from './i18n.js';
import type { Screen } from './screens.js';

export interface SettingsDeps {
  getSettings(): AppSettings;
  onChange(patch: Partial<AppSettings>): void;
  onEngineChange(patch: Partial<AppSettings['engine']>): void;
  onThresholdChange(patch: Partial<AppSettings['thresholds']>): void;
  onResetAll(): void;
  onClose(): void;
}

export class SettingsScreen implements Screen {
  readonly id = 'settings';
  readonly root: HTMLElement;
  private deps: SettingsDeps;
  private titleEl!: HTMLElement;
  private labels = new Map<string, HTMLElement>();

  constructor(deps: SettingsDeps) {
    this.deps = deps;
    this.root = el('div', { class: 'screen-content settings-scroll' });
    this.build();
  }

  private labeled(key: string, node: HTMLElement): HTMLElement {
    this.labels.set(key, node);
    return node;
  }

  private build(): void {
    const s = this.deps.getSettings();
    this.titleEl = el('h2', { text: t('set.title') });

    // Language
    const langRow = el('div', { class: 'setting-row' });
    const langSel = el('select');
    for (const [code, label] of [
      ['en', 'English'],
      ['ar', '\u0627\u0644\u0639\u0631\u0628\u064a\u0629']
    ] as const) {
      const o = el('option', { value: code, text: label });
      if (code === s.lang) o.selected = true;
      langSel.append(o);
    }
    langSel.addEventListener('change', () => {
      const lang = langSel.value === 'ar' ? 'ar' : 'en';
      setLang(lang);
      this.deps.onChange({ lang });
      this.refreshI18n();
    });
    langRow.append(this.labeled('set.language', el('label', { text: t('set.language') })), langSel);

    // Assist side
    const assistRow = el('div', { class: 'setting-row' });
    const assistSel = el('select');
    for (const v of ['white', 'black', 'both'] as AssistSide[]) {
      const key = v === 'white' ? 'set.assistWhite' : v === 'black' ? 'set.assistBlack' : 'set.assistBoth';
      const o = el('option', { value: v, text: t(key) });
      if (v === s.engine.assist) o.selected = true;
      assistSel.append(o);
    }
    assistSel.addEventListener('change', () => {
      this.deps.onEngineChange({ assist: assistSel.value as AssistSide });
      this.refreshI18n();
    });
    assistRow.append(this.labeled('set.assist', el('label', { text: t('set.assist') })), assistSel);
    this.assistSel = assistSel;

    // Engine sliders
    const skill = sliderRow(t('set.skill'), 0, 20, 1, s.engine.skill, (v) =>
      this.deps.onEngineChange({ skill: v })
    );
    const multipv = sliderRow(t('set.multipv'), 1, 3, 1, s.engine.multipv, (v) =>
      this.deps.onEngineChange({ multipv: v })
    );
    const movetime = sliderRow(t('set.movetime'), 0, 5000, 100, s.engine.movetime, (v) =>
      this.deps.onEngineChange({ movetime: v })
    );
    const depth = sliderRow(t('set.depth'), 1, 30, 1, s.engine.depthCap, (v) =>
      this.deps.onEngineChange({ depthCap: v })
    );
    this.sliderLabels = [
      [skill, 'set.skill'],
      [multipv, 'set.multipv'],
      [movetime, 'set.movetime'],
      [depth, 'set.depth']
    ];

    // Toggles
    const forceAsm = toggleRow(t('set.forceAsm'), s.engine.forceAsmJs, (v) =>
      this.deps.onEngineChange({ forceAsmJs: v })
    );
    const keepAwake = toggleRow(t('set.keepAwake'), s.keepAwake, (v) =>
      this.deps.onChange({ keepAwake: v })
    );
    const showDebug = toggleRow(t('set.debug'), s.showDebug, (v) => this.deps.onChange({ showDebug: v }));
    this.toggleLabels = [
      [forceAsm, 'set.forceAsm'],
      [keepAwake, 'set.keepAwake'],
      [showDebug, 'set.debug']
    ];

    // Vision thresholds (exposed for real-board tuning, per spec).
    const visionHeader = el('h3', { class: 'settings-section', text: t('set.vision') });
    const th = s.thresholds;
    const stable = sliderRow('stableFrames', 1, 20, 1, th.stableFrames, (v) =>
      this.deps.onThresholdChange({ stableFrames: v })
    );
    const skin = sliderRow('skinFraction', 0.01, 0.3, 0.01, th.skinFraction, (v) =>
      this.deps.onThresholdChange({ skinFraction: v })
    );
    const maxChanges = sliderRow('maxSimultaneousChanges', 2, 12, 1, th.maxSimultaneousChanges, (v) =>
      this.deps.onThresholdChange({ maxSimultaneousChanges: v })
    );
    const mass = sliderRow('massThreshold (z)', 8, 60, 1, th.massThreshold, (v) =>
      this.deps.onThresholdChange({ massThreshold: v })
    );
    const confT = sliderRow('confidenceTemperature', 0.05, 2, 0.05, th.confidenceTemperature, (v) =>
      this.deps.onThresholdChange({ confidenceTemperature: v })
    );
    const tem = sliderRow('templateEma', 0, 0.3, 0.01, th.templateEma, (v) =>
      this.deps.onThresholdChange({ templateEma: v })
    );

    const resetBtn = el('button', { class: 'btn btn-danger', text: t('set.reset') });
    resetBtn.addEventListener('click', () => this.deps.onResetAll());
    const closeBtn = el('button', { class: 'btn btn-primary btn-big', text: t('common.back') });
    closeBtn.addEventListener('click', () => this.deps.onClose());
    this.labels.set('set.reset', resetBtn);
    this.labels.set('common.back', closeBtn);

    const aboutHeader = el('h3', { class: 'settings-section', text: t('set.about') });
    const aboutBody = el('p', { class: 'settings-about', text: t('set.aboutBody') });
    this.labels.set('set.about', aboutHeader);
    this.labels.set('set.aboutBody', aboutBody);

    this.root.append(
      this.titleEl,
      langRow,
      assistRow,
      el('h3', { class: 'settings-section engine-header', text: 'Stockfish' }),
      skill.row,
      multipv.row,
      movetime.row,
      depth.row,
      forceAsm.row,
      keepAwake.row,
      showDebug.row,
      visionHeader,
      stable.row,
      skin.row,
      maxChanges.row,
      mass.row,
      confT.row,
      tem.row,
      aboutHeader,
      aboutBody,
      el('div', { class: 'cal-buttons' }, [resetBtn, closeBtn])
    );
    this.labels.set('set.vision', visionHeader);
    this.labels.set('set.title', this.titleEl);
  }

  private assistSel!: HTMLSelectElement;
  private sliderLabels: Array<[{ row: HTMLElement }, string]> = [];
  private toggleLabels: Array<[{ row: HTMLElement }, string]> = [];

  refreshI18n(): void {
    for (const [key, node] of this.labels) {
      if (node.tagName === 'LABEL' || node.tagName === 'H2' || node.tagName === 'H3' || node.tagName === 'P' || node.tagName === 'BUTTON') {
        node.textContent = t(key);
      }
    }
    for (const [sl, key] of this.sliderLabels) {
      const label = sl.row.querySelector('label');
      if (label) label.textContent = t(key);
    }
    for (const [tg, key] of this.toggleLabels) {
      const label = tg.row.querySelector('label');
      if (label) label.textContent = t(key);
    }
    // Assist select options.
    const opts = this.assistSel.querySelectorAll('option');
    const keys = ['set.assistWhite', 'set.assistBlack', 'set.assistBoth'];
    opts.forEach((o, i) => {
      o.textContent = t(keys[i] ?? '');
    });
  }
}

function toggleRow(label: string, value: boolean, onChange: (v: boolean) => void): { row: HTMLElement } {
  const input = el('input', { type: 'checkbox' });
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  return { row: el('div', { class: 'setting-row' }, [el('label', { text: label }), input]) };
}

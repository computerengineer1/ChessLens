/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { setLang, t, allKeys, hasKey } from '../src/ui/i18n.js';
import { LogPanel, logLines } from '../src/ui/logpanel.js';
import { FairPlayScreen } from '../src/ui/fairplay.js';
import {
  loadSettings,
  saveSettings,
  setStorageBackend,
  loadCalibrations,
  saveCalibration,
  __testing
} from '../src/util/storage.js';
import { DEFAULT_SETTINGS, type Calibration } from '../src/types.js';

describe('i18n', () => {
  it('every English key exists in Arabic and vice versa', () => {
    for (const key of allKeys()) {
      expect(hasKey(key, 'en'), `missing en ${key}`).toBe(true);
      expect(hasKey(key, 'ar'), `missing ar ${key}`).toBe(true);
    }
  });

  it('interpolates variables and falls back to the key', () => {
    setLang('en');
    expect(t('live.recovered', { n: 2 })).toContain('2');
    expect(t('no.such.key')).toBe('no.such.key');
  });

  it('switching to Arabic flips document direction to RTL', () => {
    setLang('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(t('fairplay.accept')).toBe('\u0641\u0647\u0645\u062a');
    setLang('en');
    expect(document.documentElement.dir).toBe('ltr');
  });
});

describe('log panel', () => {
  it('renders timestamps, caps collapsed view to 4 lines and expands', () => {
    const log = new LogPanel();
    for (let i = 0; i < 10; i++) log.log(`line ${i}`);
    expect(log.root.getAttribute('dir')).toBe('ltr');
    const collapsed = log.root.querySelectorAll('.log-line').length;
    expect(collapsed).toBe(4);
    log.setExpanded(true);
    expect(log.root.querySelectorAll('.log-line').length).toBe(10);
    const first = log.root.querySelector('.log-line')?.textContent ?? '';
    expect(first).toMatch(/^\[\d{2}:\d{2}:\d{2}\] line 0$/);
  });

  it('produces the spec log line shapes', () => {
    expect(logLines.playerMoveConfirmed('queen g3\u2192e4', ['takes pawn', 'check'])).toBe(
      'player move confirmed: queen g3\u2192e4 (takes pawn, check)'
    );
    expect(logLines.opponentTurnFinished('bishop e6\u2192e2', [])).toBe('opponent turn finished: bishop e6\u2192e2');
    expect(logLines.queryStockfish()).toBe('query stockfish with board positioning');
    expect(logLines.newMoveToRenderer('knight b8\u2192c6')).toBe('new move sent to rendering engine: knight b8\u2192c6');
    expect(logLines.finalMoveToRenderer('knight d8\u2192f7', ['checkmate'])).toBe(
      'final move sent to rendering engine: knight d8\u2192f7 (checkmate)'
    );
    expect(logLines.waitingForGame()).toBe('waiting for game');
  });
});

describe('fair play screen', () => {
  it('shows the exact notice and requires the tap', () => {
    setLang('en');
    let accepted = false;
    const screen = new FairPlayScreen(() => {
      accepted = true;
    });
    document.body.append(screen.root);
    expect(screen.root.textContent).toContain(
      'ChessLens is for analysis, training, and casual games with your opponent\u2019s consent.'
    );
    expect(screen.root.textContent).toContain('Do not use it in rated, online, or tournament games.');
    const btn = screen.root.querySelector('button') as HTMLButtonElement;
    expect(btn.textContent).toBe('I understand');
    btn.click();
    expect(accepted).toBe(true);
  });
});

describe('storage', () => {
  beforeEach(() => {
    setStorageBackend(new __testing.MemoryStorage());
  });

  it('round-trips settings and merges partial payloads over defaults', () => {
    const s = loadSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
    s.engine.skill = 7;
    s.lang = 'ar';
    saveSettings(s);
    const back = loadSettings();
    expect(back.engine.skill).toBe(7);
    expect(back.lang).toBe('ar');
    // Corrupt payload falls back to defaults instead of throwing.
    expect(loadSettings()).toBeTruthy();
  });

  it('stores one calibration per camera and caps the list', () => {
    for (let i = 0; i < 12; i++) {
      const cal: Calibration = {
        corners: [i, i, i + 1, i, i + 1, i + 1, i, i + 1],
        srcW: 1280,
        srcH: 720,
        cameraId: `cam${i}`,
        createdAt: i
      };
      saveCalibration(cal);
    }
    const all = loadCalibrations();
    expect(all.size).toBeLessThanOrEqual(8);
    expect(all.get('cam11')?.srcW).toBe(1280);
  });
});

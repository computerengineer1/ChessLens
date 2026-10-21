/**
 * Analysis mode: no camera. A virtual board with tap-to-move, engine
 * analysis of every reached position, PGN/FEN import/export, move list,
 * undo and flip. Also serves as the browser fallback on any device.
 */

import { Chess, type Move } from 'chess.js';
import type { EngineClient, EngineLine, BestMove } from '../engine/engineClient.js';
import type { LogPanel } from '../ui/logpanel.js';
import { el, clear } from './dom.js';
import { t } from './i18n.js';
import type { Screen } from './screens.js';
import { VirtualBoard } from './virtualboard.js';
import { toast, showSheet, closeSheet } from './toast.js';
import { pvToSan } from './live.js';

export interface AnalysisDeps {
  engine: EngineClient;
  log: LogPanel;
}

export class AnalysisScreen implements Screen {
  readonly id = 'analysis';
  readonly root: HTMLElement;
  private board: VirtualBoard;
  private deps: AnalysisDeps;
  private movesEl: HTMLElement;
  private fenEl: HTMLElement;
  private evalEl: HTMLElement;
  private pvEl: HTMLElement;
  private history: Move[] = [];
  private startFen = new Chess().fen();
  private labels = new Map<string, HTMLElement>();
  private bestLine: EngineLine | null = null;

  constructor(deps: AnalysisDeps) {
    this.deps = deps;
    this.board = new VirtualBoard({
      mode: 'move',
      fen: this.startFen,
      onMove: (m) => this.afterMove(m),
      onPromotionNeeded: (from, to, choose) => this.askPromotion(from, to, choose)
    });
    this.movesEl = el('div', { class: 'analysis-moves' });
    this.fenEl = el('div', { class: 'analysis-fen' });
    this.evalEl = el('div', { class: 'analysis-eval' });
    this.pvEl = el('div', { class: 'analysis-pv' });
    this.root = el('div', { class: 'screen-content settings-scroll' });
    this.build();
  }

  private build(): void {
    const title = el('h2', { text: t('ana.title') });
    this.labels.set('ana.title', title);

    const flipBtn = el('button', { class: 'btn btn-ghost', text: t('ana.flip') });
    flipBtn.addEventListener('click', () => this.board.setFlipped(!this.board.flipped));
    const newBtn = el('button', { class: 'btn btn-ghost', text: t('ana.newGame') });
    newBtn.addEventListener('click', () => this.loadFen(this.startFen));
    const undoBtn = el('button', { class: 'btn btn-ghost', text: t('resync.undo') });
    undoBtn.addEventListener('click', () => this.undo());
    const fenBtn = el('button', { class: 'btn btn-ghost', text: t('resync.pasteFen') });
    fenBtn.addEventListener('click', () => this.showFenDialog());
    const pgnBtn = el('button', { class: 'btn btn-ghost', text: t('resync.pastePgn') });
    pgnBtn.addEventListener('click', () => this.showPgnDialog());
    this.labels.set('ana.flip', flipBtn);
    this.labels.set('ana.newGame', newBtn);
    this.labels.set('resync.undo', undoBtn);
    this.labels.set('resync.pasteFen', fenBtn);
    this.labels.set('resync.pastePgn', pgnBtn);

    const lineHeader = el('h3', { class: 'settings-section', text: t('ana.engineLine') });
    this.labels.set('ana.engineLine', lineHeader);
    const movesHeader = el('h3', { class: 'settings-section', text: t('ana.moves') });
    this.labels.set('ana.moves', movesHeader);
    const fenHeader = el('h3', { class: 'settings-section', text: t('ana.fen') });
    this.labels.set('ana.fen', fenHeader);

    this.root.append(
      title,
      this.board.root,
      el('div', { class: 'cal-buttons' }, [flipBtn, undoBtn, newBtn, fenBtn, pgnBtn]),
      this.evalEl,
      lineHeader,
      this.pvEl,
      movesHeader,
      this.movesEl,
      fenHeader,
      this.fenEl
    );
    this.refreshPanels();
  }

  refreshI18n(): void {
    for (const [k, node] of this.labels) node.textContent = t(k);
  }

  onShow(): void {
    requestAnimationFrame(() => this.board.resize());
    this.analyze();
    this.attachLog();
  }

  private attachLog(): void {
    // The shared log panel lives inside the analysis screen while active.
    if (!this.logHost) {
      this.logHost = el('div', { class: 'log-host' });
      this.root.append(this.logHost);
    }
    clear(this.logHost);
    this.logHost.append(this.deps.log.root);
  }

  private logHost: HTMLElement | null = null;

  private afterMove(m: Move): void {
    this.history.push(m);
    this.refreshPanels();
    this.analyze();
  }

  private askPromotion(_from: string, _to: string, choose: (p: 'q' | 'r' | 'b' | 'n') => void): void {
    const row = el('div', { class: 'promo-row' });
    for (const p of ['q', 'r', 'b', 'n'] as const) {
      const b = el('button', { class: 'btn btn-ghost promo-btn', text: t(`live.${p === 'q' ? 'queen' : p === 'r' ? 'rook' : p === 'b' ? 'bishop' : 'knight'}`) });
      b.addEventListener('click', () => choose(p));
      row.append(b);
    }
    showSheet({
      title: t('live.promotionTitle'),
      content: row,
      buttons: [{ label: t('common.cancel'), kind: 'ghost', onClick: () => undefined }]
    });
  }

  private undo(): void {
    this.board.undo();
    this.history.pop();
    this.refreshPanels();
    this.analyze();
  }

  loadFen(fen: string): boolean {
    if (!this.board.setFen(fen)) return false;
    this.history = [];
    this.refreshPanels();
    this.analyze();
    return true;
  }

  loadPgn(pgn: string): boolean {
    const g = new Chess();
    try {
      g.loadPgn(pgn.trim());
    } catch {
      return false;
    }
    // Rebuild history from scratch for the move list.
    const replay = new Chess();
    const moves: Move[] = [];
    for (const san of g.history()) {
      const m = replay.move(san) as Move;
      moves.push(m);
    }
    if (!this.board.setFen(g.fen())) return false;
    this.history = moves;
    this.refreshPanels();
    this.analyze();
    return true;
  }

  currentFen(): string {
    return this.board.fen();
  }

  private showFenDialog(): void {
    const input = el('textarea', { class: 'resync-input', rows: 2, text: this.currentFen() });
    const apply = el('button', { class: 'btn btn-primary', text: t('resync.apply') });
    showSheet({
      title: t('resync.pasteFen'),
      content: el('div', {}, [input, apply]),
      buttons: [{ label: t('common.cancel'), kind: 'ghost', onClick: () => undefined }],
      dismissable: true
    });
    apply.addEventListener('click', () => {
      if (this.loadFen(input.value.trim())) {
        this.sheetClose();
      } else toast(t('resync.invalid'), 'error');
    });
  }

  private showPgnDialog(): void {
    const input = el('textarea', { class: 'resync-input', rows: 6 });
    const apply = el('button', { class: 'btn btn-primary', text: t('resync.apply') });
    showSheet({
      title: t('resync.pastePgn'),
      content: el('div', {}, [input, apply]),
      buttons: [{ label: t('common.cancel'), kind: 'ghost', onClick: () => undefined }],
      dismissable: true
    });
    apply.addEventListener('click', () => {
      if (this.loadPgn(input.value)) {
        this.sheetClose();
      } else toast(t('resync.invalid'), 'error');
    });
  }

  private sheetClose(): void {
    closeSheet();
  }

  private analyze(): void {
    this.deps.engine.analyze(this.currentFen());
  }

  onEngineInfo(line: EngineLine): void {
    if (line.multipv !== 1) return;
    this.bestLine = line;
    this.renderEngine();
  }

  onEngineBestMove(mv: BestMove): void {
    const fen = this.currentFen();
    const san = pvToSan([mv.uci], fen);
    this.evalEl.textContent = `${t('live.suggestion')}: ${san[0] ?? mv.uci}`;
    this.renderEngine();
  }

  private renderEngine(): void {
    if (!this.bestLine) return;
    const fen = this.currentFen();
    const sans = pvToSan(this.bestLine.pvUci.slice(0, 8), fen);
    const score =
      this.bestLine.mate !== null
        ? `M${this.bestLine.mate}`
        : this.bestLine.cp !== null
          ? `${(this.bestLine.cp / 100).toFixed(1)}`
          : '?';
    this.evalEl.textContent = `${t('live.eval')}: ${score}  |  ${t('live.depth')}: ${this.bestLine.depth}`;
    this.pvEl.textContent = sans.join(' ');
  }

  private refreshPanels(): void {
    // Move list in two-column SAN pairs.
    clear(this.movesEl);
    let text = '';
    this.history.forEach((m, i) => {
      if (i % 2 === 0) text += `${i / 2 + 1}. `;
      text += `${m.san} `;
    });
    this.movesEl.textContent = text.trim() || '\u2013';
    this.fenEl.textContent = this.currentFen();
  }
}

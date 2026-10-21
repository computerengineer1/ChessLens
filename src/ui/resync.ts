/**
 * Resync sheet: shown when the tracker loses the position.
 * Tools (per spec): tap-to-move on a virtual board, undo last move,
 * paste FEN, paste PGN, and a set-up-position editor.
 * After applying, the live screen re-checks the camera against the new
 * position and warns on mismatch.
 */

import { Chess } from 'chess.js';
import type { Tracker } from '../game/tracker.js';
import { el, clear } from './dom.js';
import { t } from './i18n.js';
import { showSheet, closeSheet, toast } from './toast.js';
import { VirtualBoard } from './virtualboard.js';

export interface ResyncDeps {
  tracker: Tracker;
  onApplied: (fen: string) => void;
}

type Tab = 'move' | 'fen' | 'pgn' | 'editor';

const EDIT_PIECES = ['wp', 'wn', 'wb', 'wr', 'wq', 'wk', 'bp', 'bn', 'bb', 'br', 'bq', 'bk', ''];

export class ResyncSheet {
  private deps: ResyncDeps;
  private board: VirtualBoard;
  private tab: Tab = 'move';
  private content: HTMLElement;
  private fenInput!: HTMLTextAreaElement;
  private pgnInput!: HTMLTextAreaElement;
  private editorBoard!: VirtualBoard;

  constructor(deps: ResyncDeps) {
    this.deps = deps;
    this.board = new VirtualBoard({
      mode: 'move',
      fen: deps.tracker.fen(),
      onMove: (m) => {
        // Apply the tapped move to the real tracker as a manual move.
        const ev = deps.tracker.applyManual(m.from, m.to, m.promotion as 'q' | 'r' | 'b' | 'n' | undefined);
        if (ev) {
          deps.onApplied(deps.tracker.fen());
          closeSheet();
        } else {
          this.board.setFen(deps.tracker.fen());
        }
      },
      onPromotionNeeded: (_from, _to, choose) => choose('q')
    });
    this.content = el('div', { class: 'resync-content' });
  }

  show(): void {
    const tabs = el('div', { class: 'resync-tabs' });
    const mkTab = (id: Tab, labelKey: string): void => {
      const b = el('button', {
        class: `btn btn-ghost tab-btn ${this.tab === id ? 'tab-active' : ''}`,
        text: t(labelKey)
      });
      b.addEventListener('click', () => {
        this.tab = id;
        this.show(); // re-render with new tab
      });
      tabs.append(b);
    };
    mkTab('move', 'resync.tapBoard');
    mkTab('fen', 'resync.pasteFen');
    mkTab('pgn', 'resync.pastePgn');
    mkTab('editor', 'resync.editor');

    clear(this.content);
    this.content.append(el('p', { class: 'sheet-note', text: t('resync.body') }));

    switch (this.tab) {
      case 'move': {
        this.board.setFen(this.deps.tracker.fen());
        const undo = el('button', { class: 'btn btn-ghost', text: t('resync.undo') });
        undo.addEventListener('click', () => {
          this.deps.tracker.undoLast();
          this.board.setFen(this.deps.tracker.fen());
          this.deps.onApplied(this.deps.tracker.fen());
        });
        this.content.append(this.board.root, el('div', { class: 'cal-buttons' }, [undo]));
        requestAnimationFrame(() => this.board.resize());
        break;
      }
      case 'fen': {
        this.fenInput = el('textarea', { class: 'resync-input', rows: 3, placeholder: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' });
        const apply = el('button', { class: 'btn btn-primary', text: t('resync.apply') });
        apply.addEventListener('click', () => this.applyFen(this.fenInput.value));
        this.content.append(this.fenInput, el('div', { class: 'cal-buttons' }, [apply]));
        break;
      }
      case 'pgn': {
        this.pgnInput = el('textarea', { class: 'resync-input', rows: 6, placeholder: '1. e4 e5 2. Nf3 Nc6 ...' });
        const apply = el('button', { class: 'btn btn-primary', text: t('resync.apply') });
        apply.addEventListener('click', () => this.applyPgn(this.pgnInput.value));
        this.content.append(this.pgnInput, el('div', { class: 'cal-buttons' }, [apply]));
        break;
      }
      case 'editor': {
        this.editorBoard = new VirtualBoard({ mode: 'edit', fen: this.deps.tracker.fen() });
        const palette = el('div', { class: 'edit-palette' });
        for (const p of EDIT_PIECES) {
          const label = p === '' ? '\u2716' : GLYPHS[p] ?? p;
          const b = el('button', { class: 'btn btn-ghost edit-piece', text: label });
          b.addEventListener('click', () => {
            this.editorBoard.setEditPiece(p);
            palette.querySelectorAll('.edit-piece').forEach((n) => n.classList.remove('selected'));
            b.classList.add('selected');
          });
          palette.append(b);
        }
        const turnRow = el('div', { class: 'setting-row' });
        const turnSel = el('select');
        turnSel.append(el('option', { value: 'w', text: t('editor.white') }), el('option', { value: 'b', text: t('editor.black') }));
        turnSel.addEventListener('change', () => this.editorBoard.setEditTurn(turnSel.value as 'w' | 'b'));
        turnRow.append(el('label', { text: t('editor.turn') }), turnSel);
        const castleRow = el('div', { class: 'setting-row' });
        const castleIn = el('input', { type: 'text', value: 'KQkq', maxlength: 4 });
        castleIn.addEventListener('input', () => this.editorBoard.setEditCastling(castleIn.value));
        castleRow.append(el('label', { text: t('editor.castling') }), castleIn);
        const done = el('button', { class: 'btn btn-primary', text: t('editor.done') });
        done.addEventListener('click', () => this.applyFen(this.editorBoard.editFen()));
        this.content.append(this.editorBoard.root, palette, turnRow, castleRow, el('div', { class: 'cal-buttons' }, [done]));
        requestAnimationFrame(() => this.editorBoard.resize());
        break;
      }
    }

    showSheet({
      title: t('resync.title'),
      content: el('div', {}, [tabs, this.content]),
      buttons: [{ label: t('common.close'), kind: 'ghost', onClick: () => undefined }],
      dismissable: true
    });
  }

  private applyFen(fen: string): void {
    const trimmed = fen.trim();
    try {
      void new Chess(trimmed);
    } catch {
      toast(t('resync.invalid'), 'error');
      return;
    }
    if (!this.deps.tracker.setPosition(trimmed)) {
      toast(t('resync.invalid'), 'error');
      return;
    }
    toast(t('resync.applied'));
    this.deps.onApplied(this.deps.tracker.fen());
    closeSheet();
  }

  private applyPgn(pgn: string): void {
    const g = new Chess();
    try {
      // chess.js 1.x: loadPgn throws on invalid input.
      g.loadPgn(pgn.trim());
    } catch {
      toast(t('resync.invalid'), 'error');
      return;
    }
    this.applyFen(g.fen());
  }
}

const GLYPHS: Record<string, string> = {
  wp: '\u2659', wn: '\u2658', wb: '\u2657', wr: '\u2656', wq: '\u2655', wk: '\u2654',
  bp: '\u265f', bn: '\u265e', bb: '\u265d', br: '\u265c', bq: '\u265b', bk: '\u265a'
};

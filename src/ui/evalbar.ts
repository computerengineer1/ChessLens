/**
 * Evaluation bar: a thin vertical bar on the screen edge with a fill that
 * tracks the current evaluation, plus a small chip showing `+1.4` / `M3`.
 */

import { el } from './dom.js';
import { evalToBar, formatEval, type EngineLine } from '../engine/engineClient.js';

export class EvalBar {
  readonly root: HTMLElement;
  private fill: HTMLElement;
  private chip: HTMLElement;
  private sideToMove: 'w' | 'b' = 'w';

  constructor() {
    this.fill = el('div', { class: 'eval-fill' });
    const track = el('div', { class: 'eval-track' }, [this.fill]);
    this.chip = el('div', { class: 'eval-chip', text: '0.0' });
    this.root = el('div', { class: 'eval-bar' }, [track, this.chip]);
  }

  setSideToMove(side: 'w' | 'b'): void {
    this.sideToMove = side;
  }

  update(line: EngineLine | null): void {
    if (!line) {
      this.fill.style.height = '50%';
      this.chip.textContent = '\u2013';
      return;
    }
    const frac = evalToBar(line.cp, line.mate, this.sideToMove);
    this.fill.style.height = `${(frac * 100).toFixed(1)}%`;
    this.chip.textContent = formatEval(line, true, this.sideToMove);
  }

  reset(): void {
    this.update(null);
  }
}

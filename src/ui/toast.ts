/** Toasts + modal sheets (confirm-move sheet, resync sheet, prompts). */

import { el, clear } from './dom.js';

let toastHost: HTMLElement | null = null;
let sheetHost: HTMLElement | null = null;

export function initOverlays(app: HTMLElement): void {
  toastHost = el('div', { id: 'toast-host' });
  sheetHost = el('div', { id: 'sheet-backdrop', class: 'hidden' });
  app.append(toastHost, sheetHost);
}

export function toast(message: string, kind: 'info' | 'warn' | 'error' = 'info', ms = 2600): void {
  if (!toastHost) return;
  const node = el('div', { class: `toast toast-${kind}`, text: message });
  toastHost.append(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 300);
  }, ms);
}

export interface SheetOptions {
  title: string;
  body?: string;
  /** Built content appended after the body text. */
  content?: HTMLElement;
  buttons: Array<{ label: string; kind?: 'primary' | 'danger' | 'ghost'; onClick: () => void; closeOnClick?: boolean }>;
  dismissable?: boolean;
}

let activeSheetCleanup: (() => void) | null = null;

export function showSheet(opts: SheetOptions): void {
  if (!sheetHost) return;
  closeSheet();
  const box = el('div', { class: 'sheet' });
  box.append(el('h3', { class: 'sheet-title', text: opts.title }));
  if (opts.body) box.append(el('p', { class: 'sheet-body', text: opts.body }));
  if (opts.content) box.append(opts.content);
  const btnRow = el('div', { class: 'sheet-buttons' });
  for (const b of opts.buttons) {
    const btn = el('button', { class: `btn btn-${b.kind ?? 'primary'}`, text: b.label });
    btn.addEventListener('click', () => {
      b.onClick();
      if (b.closeOnClick !== false) closeSheet();
    });
    btnRow.append(btn);
  }
  box.append(btnRow);
  sheetHost.append(box);
  sheetHost.classList.remove('hidden');
  const onBackdrop = (ev: MouseEvent): void => {
    if (ev.target === sheetHost && opts.dismissable !== false) closeSheet();
  };
  sheetHost.addEventListener('click', onBackdrop);
  activeSheetCleanup = () => sheetHost?.removeEventListener('click', onBackdrop);
}

export function closeSheet(): void {
  if (!sheetHost) return;
  activeSheetCleanup?.();
  activeSheetCleanup = null;
  clear(sheetHost);
  sheetHost.classList.add('hidden');
}

export function sheetVisible(): boolean {
  return !!sheetHost && !sheetHost.classList.contains('hidden');
}

/** Tiny DOM helpers - no framework, just less noise. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined> = {},
  children: Array<Node | string> = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2), v as EventListener);
    } else node.setAttribute(k, String(v));
  }
  for (const c of children) node.append(c);
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function on<K extends keyof HTMLElementEventMap>(
  node: HTMLElement,
  event: K,
  handler: (ev: HTMLElementEventMap[K]) => void,
  opts?: AddEventListenerOptions
): () => void {
  node.addEventListener(event, handler as EventListener, opts);
  return () => node.removeEventListener(event, handler as EventListener, opts);
}

/** Pointer position relative to an element, works for mouse + touch. */
export function pointerPos(node: HTMLElement, ev: PointerEvent | Touch): { x: number; y: number } {
  const r = node.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

/** Create a labeled range slider row; returns {row, input, valueLabel, set()}. */
export function sliderRow(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onChange: (v: number) => void
): { row: HTMLElement; input: HTMLInputElement; set: (v: number) => void } {
  const input = el('input', { type: 'range', min, max, step, value });
  const valueLabel = el('span', { class: 'slider-value', text: String(value) });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    valueLabel.textContent = Number.isInteger(v) ? String(v) : v.toFixed(2);
    onChange(v);
  });
  const row = el('div', { class: 'setting-row' }, [el('label', { text: label }), input, valueLabel]);
  return {
    row,
    input,
    set: (v: number) => {
      input.value = String(v);
      valueLabel.textContent = Number.isInteger(v) ? String(v) : v.toFixed(2);
    }
  };
}

/** Screen manager: one visible section at a time, with lifecycle hooks. */

export interface Screen {
  readonly id: string;
  readonly root: HTMLElement;
  onShow?(): void;
  onHide?(): void;
}

export class ScreenManager {
  private screens = new Map<string, Screen>();
  private active: Screen | null = null;
  constructor(private host: HTMLElement) {}

  register(screen: Screen): void {
    this.screens.set(screen.id, screen);
    screen.root.classList.add('screen');
    screen.root.classList.add('hidden');
    this.host.append(screen.root);
  }

  show(id: string): void {
    const next = this.screens.get(id);
    if (!next || next === this.active) return;
    if (this.active) {
      this.active.root.classList.add('hidden');
      this.active.onHide?.();
    }
    this.active = next;
    next.root.classList.remove('hidden');
    next.onShow?.();
  }

  current(): string | null {
    return this.active?.id ?? null;
  }

  get(id: string): Screen | undefined {
    return this.screens.get(id);
  }
}

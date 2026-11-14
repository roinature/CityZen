export type FooterTone = 'info' | 'warn';

export class FooterIndicator {
  private container: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'footer-indicator';
    this.container.style.display = 'none';
    parent.appendChild(this.container);

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'footer-toast';
    parent.appendChild(this.toastEl);
  }

  show(text: string, tone: FooterTone = 'info'): void {
    this.container.textContent = text;
    this.container.classList.toggle('warn', tone === 'warn');
    this.container.style.display = 'block';
  }

  update(text: string): void {
    this.container.textContent = text;
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  /** Briefly show feedback for a failed action (e.g. "Not enough money"). */
  toast(text: string, durationMs = 2200): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('visible');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('visible'), durationMs);
  }
}

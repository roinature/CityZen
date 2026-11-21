/**
 * Shown on the city screen from the moment a city is clicked until its state
 * arrives, so entering a city reacts instantly instead of leaving the player
 * on the world map with no feedback.
 */
export class CityLoading {
  private overlay: HTMLDivElement;
  private labelEl: HTMLSpanElement;
  private timeout: ReturnType<typeof setTimeout> | null = null;

  constructor(parent: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'city-loading';
    this.overlay.style.display = 'none';

    const pill = document.createElement('div');
    pill.className = 'city-loading-pill';
    const spinner = document.createElement('span');
    spinner.className = 'city-loading-spinner';
    this.labelEl = document.createElement('span');
    pill.append(spinner, this.labelEl);
    this.overlay.appendChild(pill);
    parent.appendChild(this.overlay);
  }

  /** @param onTimeout called if nothing arrived after `timeoutMs`. */
  show(label: string, onTimeout: () => void, timeoutMs = 20_000): void {
    this.labelEl.textContent = label;
    this.overlay.style.display = 'flex';
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = setTimeout(() => {
      this.timeout = null;
      if (this.isVisible()) onTimeout();
    }, timeoutMs);
  }

  hide(): void {
    this.overlay.style.display = 'none';
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  isVisible(): boolean {
    return this.overlay.style.display !== 'none';
  }
}

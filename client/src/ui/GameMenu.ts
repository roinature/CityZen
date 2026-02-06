export interface GameMenuCallbacks {
  onSave: () => void;
  onLoad: () => void;
  onRestart: () => void;
  onEndGame: () => void;
  onOptions: () => void;
  onResume: () => void;
}

export class GameMenu {
  private overlay: HTMLDivElement;
  private callbacks: GameMenuCallbacks;
  private statusEl: HTMLDivElement;

  constructor(parent: HTMLElement, callbacks: GameMenuCallbacks) {
    this.callbacks = callbacks;

    this.overlay = document.createElement('div');
    this.overlay.className = 'menu-overlay';
    this.overlay.style.display = 'none';
    this.overlay.innerHTML = `
      <div class="menu-panel">
        <h2>Menu</h2>
        <div class="menu-status" id="menu-status"></div>
        <div class="menu-buttons">
          <button class="menu-btn" data-action="resume">Resume Game</button>
          <button class="menu-btn" data-action="save">Save Game</button>
          <button class="menu-btn" data-action="load">Load Game</button>
          <button class="menu-btn" data-action="options">Options</button>
          <button class="menu-btn" data-action="restart">Restart City</button>
          <button class="menu-btn menu-btn-danger" data-action="end">End Game</button>
        </div>
        <div class="menu-hint">Press ESC to close</div>
      </div>
    `;
    parent.appendChild(this.overlay);

    this.statusEl = this.overlay.querySelector('#menu-status')!;

    // Click outside panel to close
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });

    // Button handlers
    this.overlay.querySelectorAll('.menu-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).dataset.action;
        switch (action) {
          case 'resume': this.hide(); this.callbacks.onResume(); break;
          case 'save': this.callbacks.onSave(); break;
          case 'load': this.hide(); this.callbacks.onLoad(); break;
          case 'options': this.hide(); this.callbacks.onOptions(); break;
          case 'restart': this.handleRestart(); break;
          case 'end': this.handleEndGame(); break;
        }
      });
    });
  }

  show(): void {
    this.overlay.style.display = 'flex';
    this.statusEl.textContent = '';
  }

  hide(): void {
    this.overlay.style.display = 'none';
  }

  isVisible(): boolean {
    return this.overlay.style.display !== 'none';
  }

  showStatus(message: string): void {
    this.statusEl.textContent = message;
    setTimeout(() => {
      if (this.statusEl.textContent === message) {
        this.statusEl.textContent = '';
      }
    }, 3000);
  }

  private handleRestart(): void {
    // Replace the restart button with a confirmation
    const btn = this.overlay.querySelector('[data-action="restart"]') as HTMLButtonElement;
    const originalText = btn.textContent;
    btn.textContent = 'Are you sure? Click again';
    btn.classList.add('menu-btn-confirm');

    const handler = () => {
      this.callbacks.onRestart();
      btn.textContent = originalText;
      btn.classList.remove('menu-btn-confirm');
      btn.removeEventListener('click', handler);
      this.hide();
    };

    // Replace click listener temporarily
    btn.replaceWith(btn.cloneNode(true));
    const newBtn = this.overlay.querySelector('[data-action="restart"]') as HTMLButtonElement;
    newBtn.textContent = 'Are you sure? Click again';
    newBtn.classList.add('menu-btn-confirm');
    newBtn.addEventListener('click', () => {
      this.callbacks.onRestart();
      newBtn.textContent = originalText;
      newBtn.classList.remove('menu-btn-confirm');
      this.hide();
    }, { once: true });
  }

  private handleEndGame(): void {
    const btn = this.overlay.querySelector('[data-action="end"]') as HTMLButtonElement;
    const originalText = btn.textContent;

    btn.replaceWith(btn.cloneNode(true));
    const newBtn = this.overlay.querySelector('[data-action="end"]') as HTMLButtonElement;
    newBtn.textContent = 'Confirm? Click again';
    newBtn.classList.add('menu-btn-confirm');
    newBtn.addEventListener('click', () => {
      this.callbacks.onEndGame();
      newBtn.textContent = originalText;
      newBtn.classList.remove('menu-btn-confirm');
      this.hide();
    }, { once: true });
  }
}

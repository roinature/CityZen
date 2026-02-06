import type { CityListItem } from '@cityzen/shared';

export interface GameMenuCallbacks {
  onSave: () => void;
  onLoadCity: (cityId: string) => void;
  onRestart: () => void;
  onEndGame: () => void;
  onOptions: () => void;
  onResume: () => void;
  fetchCities: () => Promise<CityListItem[]>;
}

export class GameMenu {
  private overlay: HTMLDivElement;
  private callbacks: GameMenuCallbacks;
  private statusEl: HTMLDivElement;
  private menuPanel: HTMLDivElement;
  private loadPanel: HTMLDivElement;

  constructor(parent: HTMLElement, callbacks: GameMenuCallbacks) {
    this.callbacks = callbacks;

    this.overlay = document.createElement('div');
    this.overlay.className = 'menu-overlay';
    this.overlay.style.display = 'none';
    this.overlay.innerHTML = `
      <div class="menu-panel" id="menu-main-panel">
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
      <div class="menu-panel load-panel" id="menu-load-panel" style="display:none">
        <h2>Load City</h2>
        <div class="load-city-list" id="load-city-list">
          <div class="load-loading">Loading...</div>
        </div>
        <div style="margin-top:16px">
          <button class="menu-btn" id="load-back-btn">Back</button>
        </div>
      </div>
    `;
    parent.appendChild(this.overlay);

    this.statusEl = this.overlay.querySelector('#menu-status')!;
    this.menuPanel = this.overlay.querySelector('#menu-main-panel')!;
    this.loadPanel = this.overlay.querySelector('#menu-load-panel')!;

    this.overlay.querySelector('#load-back-btn')!.addEventListener('click', () => {
      this.loadPanel.style.display = 'none';
      this.menuPanel.style.display = '';
    });

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
          case 'load': this.showLoadPanel(); break;
          case 'options': this.hide(); this.callbacks.onOptions(); break;
          case 'restart': this.handleRestart(); break;
          case 'end': this.handleEndGame(); break;
        }
      });
    });
  }

  show(): void {
    this.overlay.style.display = 'flex';
    this.menuPanel.style.display = '';
    this.loadPanel.style.display = 'none';
    this.statusEl.textContent = '';
  }

  hide(): void {
    this.overlay.style.display = 'none';
  }

  isVisible(): boolean {
    return this.overlay.style.display !== 'none';
  }

  private async showLoadPanel(): Promise<void> {
    this.menuPanel.style.display = 'none';
    this.loadPanel.style.display = '';

    const listEl = this.overlay.querySelector('#load-city-list')!;
    listEl.innerHTML = '<div class="load-loading">Loading...</div>';

    try {
      const cities = await this.callbacks.fetchCities();
      listEl.innerHTML = '';

      if (cities.length === 0) {
        listEl.innerHTML = '<div class="load-empty">No saved cities found</div>';
        return;
      }

      for (const city of cities) {
        const item = document.createElement('div');
        item.className = 'load-city-item';
        item.innerHTML = `
          <span class="load-city-name">${city.name}</span>
          <span class="load-city-stats">${city.buildingCount} buildings, ${city.playerCount} online</span>
        `;
        item.addEventListener('click', () => {
          this.hide();
          this.callbacks.onLoadCity(city.id);
        });
        listEl.appendChild(item);
      }
    } catch {
      listEl.innerHTML = '<div class="load-empty">Failed to load city list</div>';
    }
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

import type { CityListItem } from '@cityzen/shared';

export interface GameMenuCallbacks {
  isP2P?: boolean;
  onSave: () => void;
  onLoadCity: (cityId: string) => void;
  onRestart: () => void;
  onEndGame: () => void;
  onOptions: () => void;
  onPlanTown: () => void;
  onInvite?: () => void;
  onResume: () => void;
  onExportBackup?: () => void | Promise<void>;
  onImportBackup?: (rawJson: string) => void | Promise<void>;
  fetchCities: () => Promise<CityListItem[]>;
}

export class GameMenu {
  private overlay: HTMLDivElement;
  private callbacks: GameMenuCallbacks;
  private statusEl: HTMLDivElement;
  private menuPanel: HTMLDivElement;
  private loadPanel: HTMLDivElement;
  private confirmingAction: 'restart' | 'end' | null = null;

  constructor(parent: HTMLElement, callbacks: GameMenuCallbacks) {
    this.callbacks = callbacks;

    this.overlay = document.createElement('div');
    this.overlay.className = 'menu-overlay';
    this.overlay.style.display = 'none';
    this.overlay.innerHTML = `
      <div class="menu-panel" id="menu-main-panel">
        <div class="menu-header">
          <h2>Menu</h2>
          <button type="button" class="hud-button menu-close-btn" data-action="resume" aria-label="Resume Game">×</button>
        </div>
        <div class="menu-status" id="menu-status"></div>
        <div class="menu-buttons">
          <button class="menu-btn menu-btn-primary" data-action="resume">Resume Game</button>
          <div class="menu-grid">
            <button class="menu-btn" data-action="save">Save Game</button>
            <button class="menu-btn" data-action="load">Load City</button>
            <button class="menu-btn" data-action="plan">Town Planner</button>
            <button class="menu-btn" data-action="options">Options</button>
            ${callbacks.onExportBackup ? '<button class="menu-btn" data-action="export-backup">Export Backup</button>' : ''}
            ${callbacks.onImportBackup ? '<button class="menu-btn" data-action="import-backup">Import Backup</button>' : ''}
          </div>
          ${callbacks.onInvite ? '<button class="menu-btn" data-action="invite">Invite Friends</button>' : ''}
          ${callbacks.isP2P ? '' : '<button class="menu-btn" data-action="connect-x" style="background-color: #000; color: #fff;">Connect X</button>'}
          <div class="menu-divider"></div>
          <div class="menu-grid menu-danger-row">
            <button class="menu-btn menu-btn-danger" data-action="restart">Restart City</button>
            <button class="menu-btn menu-btn-danger" data-action="end">Exit to Earth</button>
          </div>
        </div>
        <div class="menu-footer">
          <span class="app-version" title="Client build version">${__APP_VERSION__}</span>
          <span class="menu-hint">ESC to close</span>
        </div>
      </div>
      <div class="menu-panel load-panel" id="menu-load-panel" style="display:none">
        <div class="menu-header">
          <h2>Load City</h2>
          <button type="button" class="hud-button menu-close-btn" id="load-close-btn" aria-label="Close">×</button>
        </div>
        <div class="load-city-list" id="load-city-list">
          <div class="load-loading">Loading...</div>
        </div>
        <div style="margin-top:12px">
          <button class="menu-btn" id="load-back-btn" style="width:100%">Back</button>
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
    this.overlay.querySelector('#load-close-btn')!.addEventListener('click', () => this.hide());

    // Click outside panel to close
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });

    // Button handlers
    this.overlay.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).dataset.action;
        if (action !== 'restart' && action !== 'end') {
          this.resetConfirmations();
        }
        switch (action) {
          case 'resume': this.hide(); this.callbacks.onResume(); break;
          case 'save': this.callbacks.onSave(); break;
          case 'load': void this.showLoadPanel(); break;
          case 'plan': this.hide(); this.callbacks.onPlanTown(); break;
          case 'options': this.hide(); this.callbacks.onOptions(); break;
          case 'invite': this.hide(); this.callbacks.onInvite?.(); break;
          case 'export-backup': void this.callbacks.onExportBackup?.(); break;
          case 'import-backup': this.promptImportBackup(); break;
          case 'connect-x': window.location.href = '/api/auth/twitter'; break;
          case 'restart': this.handleConfirmAction('restart', 'Confirm Restart', () => this.callbacks.onRestart()); break;
          case 'end': this.handleConfirmAction('end', 'Confirm Exit', () => this.callbacks.onEndGame()); break;
        }
      });
    });
  }

  show(): void {
    this.resetConfirmations();
    this.overlay.style.display = 'flex';
    this.menuPanel.style.display = '';
    this.loadPanel.style.display = 'none';
    this.statusEl.textContent = '';
  }

  hide(): void {
    this.resetConfirmations();
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

  private promptImportBackup(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        await this.callbacks.onImportBackup?.(text);
      } catch {
        this.showStatus('Could not read backup file');
      }
    };
    input.click();
  }

  private resetConfirmations(): void {
    this.confirmingAction = null;
    const restartBtn = this.overlay.querySelector('[data-action="restart"]') as HTMLButtonElement | null;
    if (restartBtn) {
      restartBtn.textContent = 'Restart City';
      restartBtn.classList.remove('menu-btn-confirm');
    }
    const endBtn = this.overlay.querySelector('[data-action="end"]') as HTMLButtonElement | null;
    if (endBtn) {
      endBtn.textContent = 'Exit to Earth';
      endBtn.classList.remove('menu-btn-confirm');
    }
  }

  private handleConfirmAction(action: 'restart' | 'end', confirmLabel: string, onConfirm: () => void): void {
    if (this.confirmingAction === action) {
      this.resetConfirmations();
      onConfirm();
      this.hide();
      return;
    }
    this.resetConfirmations();
    this.confirmingAction = action;
    const btn = this.overlay.querySelector(`[data-action="${action}"]`) as HTMLButtonElement | null;
    if (btn) {
      btn.textContent = confirmLabel;
      btn.classList.add('menu-btn-confirm');
    }
  }
}

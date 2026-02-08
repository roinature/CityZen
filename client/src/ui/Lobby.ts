export interface LobbyCallbacks {
  onEnterWorld: (playerName: string) => void;
}

export class Lobby {
  private overlay: HTMLDivElement;
  private callbacks: LobbyCallbacks;

  constructor(parent: HTMLElement, callbacks: LobbyCallbacks) {
    this.callbacks = callbacks;
    this.overlay = document.createElement('div');
    this.overlay.className = 'lobby-overlay';
    this.overlay.innerHTML = `
      <div class="lobby-panel">
        <h1>CityZen</h1>
        <p style="text-align:center;opacity:0.6;margin-bottom:20px;font-size:13px;">Build your city in a shared world</p>
        <input type="text" id="player-name" placeholder="Your name" value="Player" />
        <button id="enter-world-btn">Enter World</button>
      </div>
    `;
    parent.appendChild(this.overlay);

    const enterBtn = this.overlay.querySelector('#enter-world-btn')!;
    const nameInput = this.overlay.querySelector('#player-name') as HTMLInputElement;

    enterBtn.addEventListener('click', () => {
      const playerName = nameInput.value.trim() || 'Player';
      this.callbacks.onEnterWorld(playerName);
    });

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const playerName = nameInput.value.trim() || 'Player';
        this.callbacks.onEnterWorld(playerName);
      }
    });
  }

  show(): void {
    this.overlay.style.display = 'flex';
  }

  hide(): void {
    this.overlay.style.display = 'none';
  }

  isVisible(): boolean {
    return this.overlay.style.display !== 'none';
  }
}

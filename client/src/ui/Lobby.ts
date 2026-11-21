export class Lobby {
  private overlay = document.createElement('div');

  constructor(parent: HTMLElement, callbacks: { onEnterWorld(name: string): Promise<void> }) {
    this.overlay.className = 'lobby-overlay';
    this.overlay.innerHTML = `
      <form class="lobby-panel">
        <h1>CityZen</h1>
        <p class="worldmap-subtitle">Find a place on Earth to build your city.</p>
        <input id="player-name" aria-label="Your name" placeholder="Your name" value="Player" />
        <button id="enter-world-btn">Explore Earth</button>
        <div class="lobby-status" role="status"></div>
      </form>`;
    parent.append(this.overlay);
    const button = this.overlay.querySelector('button')!;
    const status = this.overlay.querySelector('.lobby-status')!;
    this.overlay.querySelector('form')!.onsubmit = async event => {
      event.preventDefault();
      if (button.disabled) return;
      button.disabled = true;
      status.textContent = 'Loading Earth…';
      try {
        await callbacks.onEnterWorld(this.overlay.querySelector('input')!.value.trim() || 'Player');
        status.textContent = '';
      } catch {
        status.textContent = 'Could not load Earth. Try again.';
      } finally {
        button.disabled = false;
      }
    };
  }

  show() { this.overlay.style.display = 'flex'; }
  hide() { this.overlay.style.display = 'none'; }
  isVisible() { return this.overlay.style.display !== 'none'; }
}

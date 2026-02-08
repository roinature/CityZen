export class FooterIndicator {
  private container: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'footer-indicator';
    this.container.style.display = 'none';
    parent.appendChild(this.container);
  }

  show(text: string): void {
    this.container.textContent = text;
    this.container.style.display = 'block';
  }

  update(text: string): void {
    this.container.textContent = text;
  }

  hide(): void {
    this.container.style.display = 'none';
  }
}

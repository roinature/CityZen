export type ToolMode = 'pointer' | 'bulldoze' | 'build';

export class BuildTools {
  private pointer: HTMLButtonElement;
  private bulldoze: HTMLButtonElement;
  private brush: HTMLDivElement;

  constructor(
    parent: HTMLElement,
    onToolChange: (mode: ToolMode) => void,
    onBrushSizeChange: (size: number) => void,
  ) {
    this.pointer = this.createButton('Pointer', () => onToolChange('pointer'));
    this.bulldoze = this.createButton('Bulldoze', () => onToolChange('bulldoze'));

    this.brush = document.createElement('div');
    this.brush.className = 'brush-size-control';
    this.brush.setAttribute('role', 'group');
    this.brush.setAttribute('aria-label', 'Bulldoze brush size');

    const sizeLabel = document.createElement('span');
    sizeLabel.className = 'brush-size-value';
    sizeLabel.textContent = '1';

    let size = 1;
    const changeSize = (delta: number): void => {
      size = Math.max(1, Math.min(3, size + delta));
      sizeLabel.textContent = String(size);
      onBrushSizeChange(size);
    };
    const minus = this.createButton('−', () => changeSize(-1));
    minus.setAttribute('aria-label', 'Decrease brush size');
    const plus = this.createButton('+', () => changeSize(1));
    plus.setAttribute('aria-label', 'Increase brush size');

    this.brush.append(minus, sizeLabel, plus);
    parent.append(this.pointer, this.bulldoze, this.brush);
    this.setActiveMode('pointer');
  }

  private createButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'hud-button';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  setActiveMode(mode: ToolMode): void {
    this.pointer.setAttribute('aria-pressed', String(mode === 'pointer'));
    this.bulldoze.setAttribute('aria-pressed', String(mode === 'bulldoze'));
    this.brush.hidden = mode !== 'bulldoze';
  }
}

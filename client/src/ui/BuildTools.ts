import { TOOL_ICONS } from './ToolbarIcons.js';

export type ToolMode = 'pointer' | 'bulldoze' | 'build';

export class BuildTools {
  private pointer: HTMLButtonElement;
  private bulldoze: HTMLButtonElement;
  private brush: HTMLDivElement;
  private brushButtons: HTMLButtonElement[] = [];
  private brushSize = 1;

  constructor(
    parent: HTMLElement,
    onToolChange: (mode: ToolMode) => void,
    onBrushSizeChange: (size: number) => void,
  ) {
    this.pointer = this.createIconButton('Pointer', 'Select & inspect', TOOL_ICONS.pointer, () => onToolChange('pointer'));

    const bulldozeRow = document.createElement('div');
    bulldozeRow.className = 'build-tool-anchor';

    this.bulldoze = this.createIconButton('Bulldoze', 'Demolish tiles', TOOL_ICONS.bulldoze, () => onToolChange('bulldoze'));

    this.brush = document.createElement('div');
    this.brush.className = 'brush-size-control';
    this.brush.setAttribute('role', 'group');
    this.brush.setAttribute('aria-label', 'Bulldoze brush size');

    for (const size of [1, 2, 3]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tool-round-btn tool-round-btn-sm';
      btn.textContent = `${size}×`;
      btn.setAttribute('aria-label', `Bulldoze brush ${size}×${size}`);
      btn.setAttribute('aria-pressed', String(size === this.brushSize));
      btn.dataset.tooltipTitle = `Brush ${size}×${size}`;
      btn.dataset.tooltipSub = size === 1 ? 'Single tile' : `${size * size} tiles`;
      btn.addEventListener('click', () => {
        this.brushSize = size;
        this.syncBrushButtons();
        onBrushSizeChange(size);
      });
      this.brush.appendChild(btn);
      this.brushButtons.push(btn);
    }

    bulldozeRow.append(this.bulldoze, this.brush);
    parent.append(this.pointer, bulldozeRow);
    this.setActiveMode('pointer');
  }

  private createIconButton(
    label: string,
    sub: string,
    iconSvg: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tool-round-btn';
    btn.innerHTML = iconSvg;
    btn.setAttribute('aria-label', label);
    btn.dataset.tooltipTitle = label;
    btn.dataset.tooltipSub = sub;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private syncBrushButtons(): void {
    for (let i = 0; i < this.brushButtons.length; i++) {
      this.brushButtons[i].setAttribute('aria-pressed', String(i + 1 === this.brushSize));
    }
  }

  setActiveMode(mode: ToolMode): void {
    this.pointer.setAttribute('aria-pressed', String(mode === 'pointer'));
    this.bulldoze.setAttribute('aria-pressed', String(mode === 'bulldoze'));
    this.brush.hidden = mode !== 'bulldoze';
  }
}

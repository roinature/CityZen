export type ToolMode = 'pointer' | 'bulldoze' | 'build';

export interface ToolSidebarCallbacks {
  onToolChange: (mode: ToolMode) => void;
  onBrushSizeChange: (size: number) => void;
  onDayNightToggle: () => void;
  onFinanceToggle: () => void;
  onMaslowToggle?: () => void;
}

export class ToolSidebar {
  private container: HTMLDivElement;
  private callbacks: ToolSidebarCallbacks;
  private activeMode: ToolMode = 'pointer';
  private brushSize = 1;
  private isNight = false;
  private pointerBtn!: HTMLButtonElement;
  private bulldozeBtn!: HTMLButtonElement;
  private brushSizeLabel!: HTMLSpanElement;

  constructor(parent: HTMLElement, callbacks: ToolSidebarCallbacks) {
    this.callbacks = callbacks;
    this.container = document.createElement('div');
    this.container.className = 'tool-sidebar';
    parent.appendChild(this.container);
    this.render();
  }

  private render(): void {
    // Pointer tool
    this.pointerBtn = this.createToolBtn('Pointer', '☝', () => {
      this.setActiveMode('pointer');
      this.callbacks.onToolChange('pointer');
    });
    this.pointerBtn.classList.add('active');

    // Bulldoze tool
    this.bulldozeBtn = this.createToolBtn('Bulldoze', '🏗', () => {
      this.setActiveMode('bulldoze');
      this.callbacks.onToolChange('bulldoze');
    });

    // Brush size control
    const brushGroup = document.createElement('div');
    brushGroup.className = 'tool-sidebar-item';

    const brushLabel = document.createElement('span');
    brushLabel.className = 'tool-sidebar-label';
    brushLabel.textContent = 'Brush';

    const brushControl = document.createElement('div');
    brushControl.className = 'brush-size-control';

    const minusBtn = document.createElement('button');
    minusBtn.className = 'brush-btn';
    minusBtn.textContent = '−';
    minusBtn.addEventListener('click', () => this.changeBrushSize(-1));

    this.brushSizeLabel = document.createElement('span');
    this.brushSizeLabel.className = 'brush-size-value';
    this.brushSizeLabel.textContent = '1';

    const plusBtn = document.createElement('button');
    plusBtn.className = 'brush-btn';
    plusBtn.textContent = '+';
    plusBtn.addEventListener('click', () => this.changeBrushSize(1));

    brushControl.appendChild(minusBtn);
    brushControl.appendChild(this.brushSizeLabel);
    brushControl.appendChild(plusBtn);
    brushGroup.appendChild(brushLabel);
    brushGroup.appendChild(brushControl);
    this.container.appendChild(brushGroup);

    // Separator
    this.container.appendChild(this.createSeparator());

    // Day/Night toggle
    this.createToolBtn('Day/Night', '☀', () => {
      this.isNight = !this.isNight;
      this.callbacks.onDayNightToggle();
    });

    // Finance toggle
    this.createToolBtn('Finance', '$', () => {
      this.callbacks.onFinanceToggle();
    });

    // Maslow needs toggle
    this.createToolBtn('Maslow', 'M', () => {
      this.callbacks.onMaslowToggle?.();
    });
  }

  private createToolBtn(label: string, icon: string, onClick: () => void): HTMLButtonElement {
    const item = document.createElement('div');
    item.className = 'tool-sidebar-item';

    const btn = document.createElement('button');
    btn.className = 'tool-btn';

    const iconEl = document.createElement('span');
    iconEl.className = 'tool-btn-icon';
    iconEl.textContent = icon;

    const labelEl = document.createElement('span');
    labelEl.className = 'tool-btn-label';
    labelEl.textContent = label;

    btn.appendChild(iconEl);
    btn.appendChild(labelEl);
    btn.addEventListener('click', onClick);

    item.appendChild(btn);
    this.container.appendChild(item);

    return btn;
  }

  private createSeparator(): HTMLDivElement {
    const sep = document.createElement('div');
    sep.className = 'tool-sidebar-separator';
    return sep;
  }

  private changeBrushSize(delta: number): void {
    this.brushSize = Math.max(1, Math.min(3, this.brushSize + delta));
    this.brushSizeLabel.textContent = String(this.brushSize);
    this.callbacks.onBrushSizeChange(this.brushSize);
  }

  setActiveMode(mode: ToolMode): void {
    this.activeMode = mode;
    this.pointerBtn.classList.toggle('active', mode === 'pointer');
    this.bulldozeBtn.classList.toggle('active', mode === 'bulldoze');
  }

  getActiveMode(): ToolMode {
    return this.activeMode;
  }
}

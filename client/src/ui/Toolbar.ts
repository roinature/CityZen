import { BuildingType, BUILDING_DEFS } from '@cityzen/shared';

export class Toolbar {
  private container: HTMLDivElement;
  private buttons: Map<BuildingType, HTMLButtonElement> = new Map();
  private onSelect: (type: BuildingType) => void;

  constructor(parent: HTMLElement, onSelect: (type: BuildingType) => void) {
    this.onSelect = onSelect;
    this.container = document.createElement('div');
    this.container.className = 'toolbar';
    parent.appendChild(this.container);
    this.render();
  }

  private render(): void {
    for (const [type, def] of Object.entries(BUILDING_DEFS)) {
      const btn = document.createElement('button');
      btn.className = 'toolbar-btn';

      const icon = document.createElement('div');
      icon.className = 'building-icon';
      icon.style.backgroundColor = def.color;

      const label = document.createElement('span');
      label.textContent = def.label;

      const cost = document.createElement('span');
      cost.className = 'cost';
      cost.textContent = `$${def.cost}`;

      btn.appendChild(icon);
      btn.appendChild(label);
      btn.appendChild(cost);

      btn.addEventListener('click', () => {
        this.onSelect(type as BuildingType);
      });

      this.container.appendChild(btn);
      this.buttons.set(type as BuildingType, btn);
    }
  }

  setActive(type: BuildingType | null): void {
    for (const [t, btn] of this.buttons) {
      btn.classList.toggle('active', t === type);
    }
  }
}

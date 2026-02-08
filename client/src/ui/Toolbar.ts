import { BuildingType, BUILDING_DEFS, ZONE_TYPES, ROAD_TYPES } from '@cityzen/shared';

interface ToolbarSection {
  label: string;
  types: readonly BuildingType[];
}

const SECTIONS: ToolbarSection[] = [
  { label: 'Zones', types: ZONE_TYPES },
  { label: 'Roads', types: ROAD_TYPES },
  { label: 'Other', types: [BuildingType.PARK] },
];

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
    for (const section of SECTIONS) {
      const sectionEl = document.createElement('div');
      sectionEl.className = 'toolbar-section';

      const header = document.createElement('span');
      header.className = 'toolbar-section-label';
      header.textContent = section.label;
      sectionEl.appendChild(header);

      const btnGroup = document.createElement('div');
      btnGroup.className = 'toolbar-btn-group';

      for (const type of section.types) {
        const def = BUILDING_DEFS[type];
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
          this.onSelect(type);
        });

        btnGroup.appendChild(btn);
        this.buttons.set(type, btn);
      }

      sectionEl.appendChild(btnGroup);
      this.container.appendChild(sectionEl);
    }
  }

  setActive(type: BuildingType | null): void {
    for (const [t, btn] of this.buttons) {
      btn.classList.toggle('active', t === type);
    }
  }
}

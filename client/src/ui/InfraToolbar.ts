import { BuildingType, BUILDING_DEFS, INFRA_CATEGORIES } from '@cityzen/shared';
import type { InfraCategory } from '@cityzen/shared';
import { BuildingFactory } from '../world/BuildingFactory.js';

export class InfraToolbar {
  private container: HTMLDivElement;
  private categoryBar: HTMLDivElement;
  private itemPane: HTMLDivElement;
  private activeCategory: string | null = null;
  private activeBuildingType: BuildingType | null = null;
  private categoryButtons: Map<string, HTMLButtonElement> = new Map();
  private itemButtons: Map<BuildingType, HTMLButtonElement> = new Map();
  private onSelect: (type: BuildingType) => void;

  constructor(parent: HTMLElement, onSelect: (type: BuildingType) => void) {
    this.onSelect = onSelect;

    this.container = document.createElement('div');
    this.container.className = 'infra-toolbar';

    // Item pane (bottom, shows when a category is selected)
    this.itemPane = document.createElement('div');
    this.itemPane.className = 'infra-item-pane';
    this.container.appendChild(this.itemPane);

    // Category bar (top row of icons)
    this.categoryBar = document.createElement('div');
    this.categoryBar.className = 'infra-category-bar';
    this.container.appendChild(this.categoryBar);

    this.renderCategories();
    parent.appendChild(this.container);
  }

  private renderCategories(): void {
    for (const cat of INFRA_CATEGORIES) {
      const btn = document.createElement('button');
      btn.className = 'infra-cat-btn';
      btn.title = cat.label;

      const icon = document.createElement('span');
      icon.className = 'infra-cat-icon';
      icon.textContent = cat.icon;

      const label = document.createElement('span');
      label.className = 'infra-cat-label';
      label.textContent = cat.label;

      btn.appendChild(icon);
      btn.appendChild(label);

      btn.addEventListener('click', () => {
        if (this.activeCategory === cat.id) {
          this.closePane();
        } else {
          this.openCategory(cat);
        }
      });

      this.categoryBar.appendChild(btn);
      this.categoryButtons.set(cat.id, btn);
    }
  }

  private openCategory(cat: InfraCategory): void {
    this.activeCategory = cat.id;

    // Update active state on category buttons
    for (const [id, btn] of this.categoryButtons) {
      btn.classList.toggle('active', id === cat.id);
    }

    // Render items
    this.itemPane.innerHTML = '';
    this.itemButtons.clear();
    this.itemPane.classList.add('open');

    for (const type of cat.types) {
      const def = BUILDING_DEFS[type];
      const btn = document.createElement('button');
      btn.className = 'infra-item-btn';
      if (type === this.activeBuildingType) {
        btn.classList.add('active');
      }

      // Color swatch / texture preview
      const preview = document.createElement('div');
      preview.className = 'infra-item-preview';
      const iconPath = BuildingFactory.getBuildingIcon(type);
      if (iconPath) {
        preview.style.backgroundImage = `url(${iconPath})`;
        preview.style.backgroundSize = 'cover';
        preview.style.backgroundPosition = 'center';
      } else {
        preview.style.backgroundColor = def.color;
      }

      // Size badge
      const sizeBadge = document.createElement('span');
      sizeBadge.className = 'infra-item-size';
      sizeBadge.textContent = `${def.size.w}x${def.size.d}`;
      preview.appendChild(sizeBadge);

      const info = document.createElement('div');
      info.className = 'infra-item-info';

      const name = document.createElement('span');
      name.className = 'infra-item-name';
      name.textContent = def.label;

      const cost = document.createElement('span');
      cost.className = 'infra-item-cost';
      cost.textContent = `$${def.cost.toLocaleString()}`;

      info.appendChild(name);
      info.appendChild(cost);

      btn.appendChild(preview);
      btn.appendChild(info);

      btn.addEventListener('click', () => {
        this.onSelect(type);
      });

      this.itemPane.appendChild(btn);
      this.itemButtons.set(type, btn);
    }
  }

  private closePane(): void {
    this.activeCategory = null;
    this.itemPane.classList.remove('open');
    this.itemPane.innerHTML = '';
    this.itemButtons.clear();
    for (const btn of this.categoryButtons.values()) {
      btn.classList.remove('active');
    }
  }

  setActive(type: BuildingType | null): void {
    this.activeBuildingType = type;
    for (const [t, btn] of this.itemButtons) {
      btn.classList.toggle('active', t === type);
    }
    // If null, also deselect category
    if (type === null) {
      this.closePane();
    }
  }
}

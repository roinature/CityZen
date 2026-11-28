import { EXPLORE_MODES, type ExploreKind } from '../world/explore/ExploreMode.js';
import { EXPLORE_ICONS, SECONDARY_ICONS } from './ToolbarIcons.js';

export interface SecondaryToolbarCallbacks {
  onFinance: () => void;
  onExploreToggle: () => boolean;
  onExploreSelect: (kind: ExploreKind) => void;
  onPerspective: () => void;
  onToggleNight: () => void;
  onMenu: () => void;
}

export class SecondaryToolbar {
  private dock: HTMLDivElement;
  private exploreRail: HTMLDivElement;
  private exploreBtn: HTMLButtonElement;
  private nightBtn: HTMLButtonElement;
  private tooltip: HTMLDivElement;
  private exploreItemButtons = new Map<ExploreKind, HTMLButtonElement>();
  private exploreOpen = false;

  constructor(
    parent: HTMLElement,
    private callbacks: SecondaryToolbarCallbacks,
  ) {
    this.dock = document.createElement('div');
    this.dock.className = 'secondary-dock';

    // Level 2: Explore sub-options rail (opens to the left of the right-side main rail)
    this.exploreRail = document.createElement('div');
    this.exploreRail.className = 'build-rail secondary-rail-sub';
    this.exploreRail.id = 'secondary-explore-rail';
    this.exploreRail.setAttribute('role', 'menu');
    this.exploreRail.setAttribute('aria-label', 'Explore modes');
    this.exploreRail.hidden = true;

    for (const kind of Object.keys(EXPLORE_MODES) as ExploreKind[]) {
      const { label, key } = EXPLORE_MODES[kind];
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'tool-round-btn';
      item.innerHTML = EXPLORE_ICONS[kind] ?? '';
      item.setAttribute('role', 'menuitem');
      item.setAttribute('aria-label', `${label} (${key})`);
      item.setAttribute('aria-pressed', 'false');
      item.dataset.tooltipTitle = label;
      item.dataset.tooltipSub = `Shortcut: ${key}`;
      item.addEventListener('click', () => {
        this.setExploreOpen(false);
        this.callbacks.onExploreSelect(kind);
      });
      this.exploreRail.appendChild(item);
      this.exploreItemButtons.set(kind, item);
    }

    // Level 1: Secondary vertical main rail on the right
    const mainRail = document.createElement('div');
    mainRail.className = 'build-rail secondary-rail-main';
    mainRail.setAttribute('role', 'toolbar');
    mainRail.setAttribute('aria-label', 'City controls');

    const financeBtn = this.createButton(
      'Finance',
      'City Finances & Loans',
      SECONDARY_ICONS.finance,
      () => {
        this.setExploreOpen(false);
        this.callbacks.onFinance();
      },
    );

    this.exploreBtn = this.createButton(
      'Explore',
      'Drive, walk, fly or sail',
      SECONDARY_ICONS.explore,
      () => {
        if (this.callbacks.onExploreToggle()) {
          this.setExploreOpen(false);
          return;
        }
        this.setExploreOpen(!this.exploreOpen);
      },
    );
    this.exploreBtn.setAttribute('aria-pressed', 'false');
    this.exploreBtn.setAttribute('aria-haspopup', 'menu');
    this.exploreBtn.setAttribute('aria-controls', this.exploreRail.id);
    this.exploreBtn.setAttribute('aria-expanded', 'false');

    const sep1 = document.createElement('div');
    sep1.className = 'build-rail-sep';

    const perspectiveBtn = this.createButton(
      'Perspective',
      'Switch camera view (V)',
      SECONDARY_ICONS.perspective,
      () => this.callbacks.onPerspective(),
    );

    this.nightBtn = this.createButton(
      'Night View',
      'Toggle Day / Night',
      SECONDARY_ICONS.night,
      () => this.callbacks.onToggleNight(),
    );
    this.nightBtn.setAttribute('aria-pressed', 'false');

    const sep2 = document.createElement('div');
    sep2.className = 'build-rail-sep';

    const menuBtn = this.createButton(
      'Menu',
      'Game Menu (Esc)',
      SECONDARY_ICONS.menu,
      () => {
        this.setExploreOpen(false);
        this.callbacks.onMenu();
      },
    );

    mainRail.append(
      financeBtn,
      this.exploreBtn,
      sep1,
      perspectiveBtn,
      this.nightBtn,
      sep2,
      menuBtn,
    );

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'build-tooltip';
    this.tooltip.setAttribute('role', 'tooltip');
    this.tooltip.hidden = true;

    this.dock.append(this.exploreRail, mainRail, this.tooltip);
    parent.appendChild(this.dock);

    this.bindTooltips();
    document.addEventListener('pointerdown', (event) => {
      if (this.exploreOpen && !this.dock.contains(event.target as Node)) {
        this.setExploreOpen(false);
      }
    });
  }

  private createButton(
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

  private bindTooltips(): void {
    let activeTarget: HTMLElement | null = null;

    const show = (target: HTMLElement): void => {
      const title = target.dataset.tooltipTitle;
      if (!title) return;
      activeTarget = target;
      const sub = target.dataset.tooltipSub;
      this.tooltip.replaceChildren();
      const titleEl = document.createElement('span');
      titleEl.className = 'build-tooltip-title';
      titleEl.textContent = title;
      this.tooltip.appendChild(titleEl);
      if (sub) {
        const subEl = document.createElement('span');
        subEl.className = 'build-tooltip-sub';
        subEl.textContent = sub;
        this.tooltip.appendChild(subEl);
      }
      this.tooltip.hidden = false;

      const rect = target.getBoundingClientRect();
      const tipWidth = this.tooltip.offsetWidth;
      const tipHeight = this.tooltip.offsetHeight;
      const top = Math.max(8, Math.min(rect.top + rect.height / 2 - tipHeight / 2, window.innerHeight - tipHeight - 8));
      const left = Math.max(8, rect.left - tipWidth - 10);
      this.tooltip.style.left = `${left}px`;
      this.tooltip.style.top = `${top}px`;
    };

    const hide = (): void => {
      activeTarget = null;
      this.tooltip.hidden = true;
    };

    this.dock.addEventListener('pointerover', (event) => {
      if ((event as PointerEvent).pointerType === 'touch') return;
      const btn = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tooltip-title]');
      if (btn) show(btn);
    });

    this.dock.addEventListener('pointerout', (event) => {
      if (!activeTarget) return;
      const next = (event.relatedTarget as HTMLElement | null)?.closest<HTMLElement>('[data-tooltip-title]');
      if (next !== activeTarget) hide();
    });

    this.dock.addEventListener('focusin', (event) => {
      const btn = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tooltip-title]');
      if (btn && btn.matches(':focus-visible')) show(btn);
    });

    this.dock.addEventListener('focusout', () => hide());
  }

  setNight(isNight: boolean): void {
    this.nightBtn.innerHTML = isNight ? SECONDARY_ICONS.day : SECONDARY_ICONS.night;
    this.nightBtn.setAttribute('aria-pressed', String(isNight));
    this.nightBtn.setAttribute('aria-label', isNight ? 'Day View' : 'Night View');
    this.nightBtn.dataset.tooltipTitle = isNight ? 'Day View' : 'Night View';
    this.nightBtn.dataset.tooltipSub = isNight ? 'Switch to daylight' : 'Switch to night';
  }

  setExploreActive(kind: ExploreKind | null): void {
    this.exploreBtn.setAttribute('aria-pressed', String(!!kind));
    for (const [k, btn] of this.exploreItemButtons) {
      btn.setAttribute('aria-pressed', String(k === kind));
    }
  }

  setExploreOpen(open: boolean): void {
    this.exploreOpen = open;
    this.exploreRail.hidden = !open;
    this.exploreBtn.setAttribute('aria-expanded', String(open));
    if (!open) this.tooltip.hidden = true;
  }

  isExploreOpen(): boolean {
    return this.exploreOpen;
  }

  close(): boolean {
    if (!this.exploreOpen) return false;
    this.setExploreOpen(false);
    return true;
  }
}

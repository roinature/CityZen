import { EMIGRATION_HAPPINESS_THRESHOLD, getZoneLevelHappinessRequirement, type CityState } from '@cityzen/shared';
import {
  LOW_HAPPINESS, getBlockedZoneLevel, getHappinessAdvice, needsHappinessAdvice, type AdvisorAction,
} from './happinessAdvice.js';

export class CityAdvisor {
  private dialog: HTMLDialogElement;
  private status: HTMLParagraphElement;
  private pauseNote: HTMLParagraphElement;
  private recommendations: HTMLOListElement;
  private adviceKey = '';
  private actions: AdvisorAction[] = [];

  constructor(parent: HTMLElement, onAction: (action: AdvisorAction) => void) {
    this.dialog = document.createElement('dialog');
    this.dialog.id = 'city-advisor';
    this.dialog.className = 'city-advisor';
    this.dialog.setAttribute('aria-labelledby', 'city-advisor-title');
    this.dialog.innerHTML = `
      <header>
        <h2 id="city-advisor-title">City Advisor</h2>
        <button type="button" class="hud-button advisor-close" aria-label="Close City Advisor" autofocus>×</button>
      </header>
      <p class="advisor-status"></p>
      <p class="advisor-pause" hidden>The simulation is paused. Resume it to see how changes affect happiness.</p>
      <ol class="advisor-recommendations"></ol>
    `;
    this.status = this.dialog.querySelector('.advisor-status')!;
    this.pauseNote = this.dialog.querySelector('.advisor-pause')!;
    this.recommendations = this.dialog.querySelector('ol')!;
    this.dialog.querySelector('.advisor-close')!.addEventListener('click', () => this.hide());
    this.recommendations.addEventListener('click', event => {
      if (!(event.target instanceof HTMLButtonElement)) return;
      const action = this.actions[Number(event.target.dataset.action)];
      if (!action) return;
      this.hide();
      onAction(action);
    });
    parent.appendChild(this.dialog);
  }

  show(city: CityState): void {
    this.update(city);
    if (!this.dialog.open) this.dialog.showModal();
  }

  hide(): void {
    this.dialog.close();
  }

  isOpen(): boolean {
    return this.dialog.open;
  }

  update(city: CityState): void {
    const low = needsHappinessAdvice(city);
    const advice = getHappinessAdvice(city);
    const blockedLevel = getBlockedZoneLevel(city);
    const happiness = Math.floor(city.resources.happiness);
    const migration = happiness < EMIGRATION_HAPPINESS_THRESHOLD
      ? ` Residents can start leaving below ${EMIGRATION_HAPPINESS_THRESHOLD}%.`
      : '';
    const status = city.resources.population === 0
      ? 'Advice will appear when residents move in.'
      : low
        ? `Happiness is at ${happiness}%, below the ${LOW_HAPPINESS}% alert threshold.${migration}`
        : blockedLevel !== undefined
          ? `Happiness is at ${happiness}%. Zones need ${getZoneLevelHappinessRequirement(blockedLevel)}% happiness to develop to level ${blockedLevel}.`
          : advice.length > 0
            ? `Happiness is at ${happiness}%. Ways to improve citizen satisfaction:`
            : `Happiness is at ${happiness}%. Citizens are satisfied and no urgent improvements are needed.`;
    if (this.status.textContent !== status) this.status.textContent = status;
    this.pauseNote.hidden = advice.length === 0 || city.clock?.speed !== 0;
    const key = JSON.stringify(advice);
    if (key === this.adviceKey) return;
    this.adviceKey = key;
    const focused = document.activeElement;
    const focusedAction = focused instanceof HTMLButtonElement && this.recommendations.contains(focused)
      ? this.actions[Number(focused.dataset.action)] : undefined;
    this.actions = advice.map(item => item.action);
    this.recommendations.replaceChildren();
    for (const [index, item] of advice.entries()) {
      const row = document.createElement('li');
      const title = document.createElement('h3');
      const summary = document.createElement('p');
      const button = document.createElement('button');
      title.textContent = item.title;
      summary.textContent = item.detail;
      button.type = 'button';
      button.className = 'hud-button';
      button.dataset.action = String(index);
      button.textContent = item.action.kind === 'build' ? 'Find in build menu'
        : item.action.kind === 'finance' ? 'Open Finance' : 'Open City Needs';
      row.append(title, summary, button);
      this.recommendations.appendChild(row);
    }
    if (focusedAction) {
      const index = this.actions.findIndex(action => JSON.stringify(action) === JSON.stringify(focusedAction));
      const next = this.recommendations.querySelector<HTMLButtonElement>(`[data-action="${index}"]`);
      (next ?? this.dialog.querySelector<HTMLButtonElement>('.advisor-close'))?.focus();
    }
  }
}

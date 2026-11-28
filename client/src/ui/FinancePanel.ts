import type { CityState, Loan, TaxRates } from '@cityzen/shared';
import {
  calculateTaxBreakdown,
  calculateExpenseBreakdown,
  calculateLaborStats,
  calculateLoanPayments,
  calculateCreditRating,
  calculateTaxCompliance,
  evaluateMilestones,
  getEffectiveTaxRates,
  getAvailableCredit,
  getOutstandingDebt,
  quoteLoan,
  validateLoanRequest,
  LOAN_TERMS,
  LOAN_MIN_AMOUNT,
  LOAN_AMOUNT_STEP,
  MAX_ACTIVE_LOANS,
  TICKS_PER_GAME_DAY,
  MIN_TAX_RATE,
  MAX_TAX_RATE,
  TAX_RATE_STEP,
  TAX_COMFORT_RATE,
  TAX_LAFFER_THRESHOLD,
} from '@cityzen/shared';

export interface FinancePanelCallbacks {
  onTaxRateChange: (rate: number) => void;
  onTaxRatesChange?: (rates: Partial<TaxRates>) => void;
  onTakeLoan: (amount: number, termDays: number) => Promise<{ success: boolean; error?: string }>;
  onRepayLoan: (loanId: string) => Promise<{ success: boolean; error?: string }>;
}

type SectorKey = keyof TaxRates;
type CadenceMode = 'tick' | 'day';

function money(value: number, decimals = false): string {
  const abs = Math.abs(value);
  const formatted = decimals && abs < 100
    ? abs.toFixed(1)
    : Math.round(abs).toLocaleString();
  return `${value < -0.005 ? '-' : ''}$${formatted}`;
}

function signedMoney(value: number, decimals = false): string {
  const abs = Math.abs(value);
  const formatted = decimals && abs < 100
    ? abs.toFixed(1)
    : Math.round(abs).toLocaleString();
  return `${value < -0.005 ? '-' : '+'}$${formatted}`;
}

function describeTaxPolicy(rate: number): { text: string; cls: string } {
  if (rate < TAX_COMFORT_RATE) {
    return { text: 'Incentive', cls: 'finance-tag-boost' };
  }
  if (rate <= TAX_COMFORT_RATE + 1) {
    return { text: 'Neutral', cls: 'finance-tag-neutral' };
  }
  if (rate > TAX_LAFFER_THRESHOLD) {
    const eff = Math.round(calculateTaxCompliance(rate) * 100);
    return { text: `${eff}% coll.`, cls: 'finance-tag-warn' };
  }
  return { text: 'Drag', cls: 'finance-tag-drag' };
}

export class FinancePanel {
  private overlay: HTMLDivElement;
  private ratingBadgeEl!: HTMLSpanElement;
  private cadenceBtns: HTMLButtonElement[] = [];
  private milestoneEl!: HTMLDivElement;

  // Tax controls
  private modeToggleBtn!: HTMLButtonElement;
  private unifiedBox!: HTMLDivElement;
  private sectorBox!: HTMLDivElement;
  private unifiedSlider!: HTMLInputElement;
  private unifiedRateEl!: HTMLSpanElement;
  private unifiedTagEl!: HTMLSpanElement;
  private sectorSliders!: Record<SectorKey, HTMLInputElement>;
  private sectorRateEls!: Record<SectorKey, HTMLSpanElement>;
  private sectorTagEls!: Record<SectorKey, HTMLSpanElement>;
  private perSectorMode = false;

  private bodyEl!: HTMLDivElement;
  private loansEl!: HTMLDivElement;
  private amountSlider!: HTMLInputElement;
  private amountLabel!: HTMLSpanElement;
  private termBtns: HTMLButtonElement[] = [];
  private quoteEl!: HTMLDivElement;
  private takeBtn!: HTMLButtonElement;
  private statusEl!: HTMLDivElement;
  private creditEl!: HTMLSpanElement;

  private callbacks: FinancePanelCallbacks | null;
  private state: CityState | null = null;
  private cadence: CadenceMode = 'day';
  private selectedTermDays: number = LOAN_TERMS[1].days;
  private busy = false;
  private visible = false;

  constructor(parent: HTMLElement, callbacks?: FinancePanelCallbacks) {
    this.callbacks = callbacks ?? null;
    this.overlay = document.createElement('div');
    this.overlay.className = 'finance-overlay';
    this.overlay.style.display = 'none';
    parent.appendChild(this.overlay);
    this.render();

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
  }

  private render(): void {
    const panel = document.createElement('div');
    panel.className = 'finance-panel';

    // Header with Credit Rating badge + Per Tick / Per Day toggle
    const headerRow = document.createElement('div');
    headerRow.className = 'finance-header-row';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'finance-title-wrap';
    const header = document.createElement('h2');
    header.textContent = 'City Finances';
    this.ratingBadgeEl = document.createElement('span');
    this.ratingBadgeEl.className = 'finance-rating-badge';
    this.ratingBadgeEl.title = 'Municipal Credit Rating (affects loan interest rates)';
    titleWrap.append(header, this.ratingBadgeEl);

    const cadenceWrap = document.createElement('div');
    cadenceWrap.className = 'finance-cadence-toggle';
    for (const [mode, label] of [['tick', '/tick'], ['day', '/day']] as const) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'finance-cadence-btn';
      btn.dataset.mode = mode;
      btn.textContent = label;
      btn.addEventListener('click', () => {
        this.cadence = mode;
        this.syncCadenceButtons();
        if (this.state) this.update(this.state);
      });
      cadenceWrap.appendChild(btn);
      this.cadenceBtns.push(btn);
    }
    headerRow.append(titleWrap, cadenceWrap);
    panel.appendChild(headerRow);
    this.syncCadenceButtons();

    // Next milestone progress card
    this.milestoneEl = document.createElement('div');
    this.milestoneEl.className = 'finance-milestone';
    panel.appendChild(this.milestoneEl);

    // Tax policy section
    panel.appendChild(this.renderTaxControls());

    // Categorized cashflow ledger
    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'finance-body';
    panel.appendChild(this.bodyEl);

    // Loans
    panel.appendChild(this.renderLoanSection());

    const closeBtn = document.createElement('button');
    closeBtn.className = 'menu-btn';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => this.hide());
    panel.appendChild(closeBtn);

    this.overlay.appendChild(panel);
  }

  private syncCadenceButtons(): void {
    for (const btn of this.cadenceBtns) {
      btn.classList.toggle('active', btn.dataset.mode === this.cadence);
    }
  }

  private renderTaxControls(): HTMLDivElement {
    const controls = document.createElement('div');
    controls.className = 'finance-tax-controls';

    const topRow = document.createElement('div');
    topRow.className = 'finance-tax-header';
    const title = document.createElement('span');
    title.className = 'finance-section-title';
    title.textContent = 'Tax Policy';
    this.modeToggleBtn = document.createElement('button');
    this.modeToggleBtn.type = 'button';
    this.modeToggleBtn.className = 'finance-mode-btn';
    this.modeToggleBtn.textContent = 'Per Sector';
    this.modeToggleBtn.addEventListener('click', () => {
      this.perSectorMode = !this.perSectorMode;
      this.syncTaxModeUI();
    });
    topRow.append(title, this.modeToggleBtn);
    controls.appendChild(topRow);

    // Unified single slider
    this.unifiedBox = document.createElement('div');
    this.unifiedBox.innerHTML = `
      <label class="finance-row" for="tax-slider">
        <span>All Sectors</span>
        <span class="finance-tax-val-wrap">
          <span class="finance-tax-tag" id="finance-tax-tag"></span>
          <span class="finance-value" id="finance-tax-rate"></span>
        </span>
      </label>
      <input type="range" id="tax-slider" class="finance-loan-slider"
        min="${MIN_TAX_RATE}" max="${MAX_TAX_RATE}" step="${TAX_RATE_STEP}" />
    `;
    this.unifiedRateEl = this.unifiedBox.querySelector('#finance-tax-rate')!;
    this.unifiedTagEl = this.unifiedBox.querySelector('#finance-tax-tag')!;
    this.unifiedSlider = this.unifiedBox.querySelector('#tax-slider')!;
    this.unifiedSlider.addEventListener('input', () => {
      const val = this.unifiedSlider.valueAsNumber;
      this.unifiedRateEl.textContent = `${val}%`;
      this.applyTag(this.unifiedTagEl, val);
    });
    this.unifiedSlider.addEventListener('change', () => {
      this.callbacks?.onTaxRateChange(this.unifiedSlider.valueAsNumber);
    });
    controls.appendChild(this.unifiedBox);

    // Per-sector sliders (R / C / I)
    this.sectorBox = document.createElement('div');
    this.sectorBox.className = 'finance-sector-grid';
    this.sectorSliders = {} as Record<SectorKey, HTMLInputElement>;
    this.sectorRateEls = {} as Record<SectorKey, HTMLSpanElement>;
    this.sectorTagEls = {} as Record<SectorKey, HTMLSpanElement>;

    const sectors: Array<{ key: SectorKey; label: string; color: string }> = [
      { key: 'residential', label: 'Residential', color: '#66BB6A' },
      { key: 'commercial', label: 'Commercial', color: '#42A5F5' },
      { key: 'industrial', label: 'Industrial', color: '#FFA726' },
    ];
    for (const s of sectors) {
      const wrap = document.createElement('div');
      wrap.className = 'finance-sector-row';
      wrap.innerHTML = `
        <label class="finance-row" for="tax-slider-${s.key}">
          <span class="finance-sector-label">
            <span class="finance-sector-dot" style="background:${s.color}"></span>
            ${s.label}
          </span>
          <span class="finance-tax-val-wrap">
            <span class="finance-tax-tag" id="finance-tax-tag-${s.key}"></span>
            <span class="finance-value" id="finance-tax-rate-${s.key}"></span>
          </span>
        </label>
        <input type="range" id="tax-slider-${s.key}" class="finance-loan-slider"
          style="accent-color:${s.color}"
          min="${MIN_TAX_RATE}" max="${MAX_TAX_RATE}" step="${TAX_RATE_STEP}" />
      `;
      const slider = wrap.querySelector<HTMLInputElement>(`#tax-slider-${s.key}`)!;
      const rateEl = wrap.querySelector<HTMLSpanElement>(`#finance-tax-rate-${s.key}`)!;
      const tagEl = wrap.querySelector<HTMLSpanElement>(`#finance-tax-tag-${s.key}`)!;
      slider.addEventListener('input', () => {
        const val = slider.valueAsNumber;
        rateEl.textContent = `${val}%`;
        this.applyTag(tagEl, val);
      });
      slider.addEventListener('change', () => {
        const val = slider.valueAsNumber;
        if (this.callbacks?.onTaxRatesChange) {
          this.callbacks.onTaxRatesChange({ [s.key]: val });
        } else {
          this.callbacks?.onTaxRateChange(val);
        }
      });
      this.sectorSliders[s.key] = slider;
      this.sectorRateEls[s.key] = rateEl;
      this.sectorTagEls[s.key] = tagEl;
      this.sectorBox.appendChild(wrap);
    }
    controls.appendChild(this.sectorBox);

    const hint = document.createElement('p');
    hint.id = 'finance-tax-hint';
    hint.textContent = `Under ${TAX_COMFORT_RATE}% boosts demand; above ${TAX_LAFFER_THRESHOLD}% triggers tax evasion.`;
    controls.appendChild(hint);

    this.syncTaxModeUI();
    return controls;
  }

  private applyTag(el: HTMLSpanElement, rate: number): void {
    const info = describeTaxPolicy(rate);
    el.textContent = info.text;
    el.className = `finance-tax-tag ${info.cls}`;
  }

  private syncTaxModeUI(): void {
    this.unifiedBox.style.display = this.perSectorMode ? 'none' : 'block';
    this.sectorBox.style.display = this.perSectorMode ? 'flex' : 'none';
    this.modeToggleBtn.textContent = this.perSectorMode ? 'Unified' : 'Per Sector';
  }

  private renderLoanSection(): HTMLDivElement {
    const section = document.createElement('div');
    section.className = 'finance-loans';

    const title = document.createElement('h3');
    title.textContent = 'Municipal Bonds & Loans';
    section.appendChild(title);

    this.loansEl = document.createElement('div');
    this.loansEl.className = 'finance-loan-list';
    section.appendChild(this.loansEl);

    const form = document.createElement('div');
    form.className = 'finance-loan-form';

    const amountRow = document.createElement('div');
    amountRow.className = 'finance-row';
    const amountTitle = document.createElement('span');
    amountTitle.className = 'finance-label';
    amountTitle.textContent = 'Borrow';
    this.amountLabel = document.createElement('span');
    this.amountLabel.className = 'finance-value';
    amountRow.append(amountTitle, this.amountLabel);
    form.appendChild(amountRow);

    this.amountSlider = document.createElement('input');
    this.amountSlider.type = 'range';
    this.amountSlider.className = 'finance-loan-slider';
    this.amountSlider.min = String(LOAN_MIN_AMOUNT);
    this.amountSlider.step = String(LOAN_AMOUNT_STEP);
    this.amountSlider.max = String(LOAN_MIN_AMOUNT);
    this.amountSlider.value = String(LOAN_MIN_AMOUNT);
    this.amountSlider.setAttribute('aria-label', 'Loan amount');
    this.amountSlider.addEventListener('input', () => this.refreshQuote());
    form.appendChild(this.amountSlider);

    const creditRow = document.createElement('div');
    creditRow.className = 'finance-loan-credit';
    this.creditEl = document.createElement('span');
    creditRow.appendChild(this.creditEl);
    form.appendChild(creditRow);

    const termRow = document.createElement('div');
    termRow.className = 'finance-loan-terms';
    for (const term of LOAN_TERMS) {
      const btn = document.createElement('button');
      btn.className = 'finance-term-btn';
      btn.dataset.days = String(term.days);
      const days = document.createElement('span');
      days.className = 'finance-term-days';
      days.textContent = `${term.days}d`;
      const rate = document.createElement('span');
      rate.className = 'finance-term-rate';
      rate.textContent = `${Math.round(term.interestRate * 100)}%`;
      btn.append(days, rate);
      btn.addEventListener('click', () => {
        this.selectedTermDays = term.days;
        this.refreshQuote();
      });
      termRow.appendChild(btn);
      this.termBtns.push(btn);
    }
    form.appendChild(termRow);

    this.quoteEl = document.createElement('div');
    this.quoteEl.className = 'finance-loan-quote';
    form.appendChild(this.quoteEl);

    this.takeBtn = document.createElement('button');
    this.takeBtn.className = 'menu-btn finance-loan-take';
    this.takeBtn.addEventListener('click', () => this.takeLoan());
    form.appendChild(this.takeBtn);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'finance-loan-status';
    form.appendChild(this.statusEl);

    section.appendChild(form);
    return section;
  }

  update(state: CityState): void {
    this.state = state;
    const res = state.resources;
    const taxes = calculateTaxBreakdown(state);
    const expenses = calculateExpenseBreakdown(state);
    const labor = calculateLaborStats(state);
    const loanPayments = calculateLoanPayments(res);
    const credit = calculateCreditRating(state);
    const rates = getEffectiveTaxRates(res);
    const debt = getOutstandingDebt(res);

    // Auto-switch to Per Sector if the city already has diverging rates
    if (rates.residential !== rates.commercial || rates.commercial !== rates.industrial) {
      if (!this.perSectorMode) {
        this.perSectorMode = true;
        this.syncTaxModeUI();
      }
    }

    // Credit rating badge
    this.ratingBadgeEl.textContent = credit.rating;
    this.ratingBadgeEl.className = `finance-rating-badge rating-${credit.rating.toLowerCase()}`;

    // Next milestone progress card
    this.renderMilestoneCard(res.population, res.claimedMilestones ?? []);

    // Sync sliders (unless actively dragged)
    if (!this.unifiedSlider.matches(':active')) {
      this.unifiedSlider.value = String(res.taxRate);
      this.unifiedRateEl.textContent = `${res.taxRate}%`;
      this.applyTag(this.unifiedTagEl, res.taxRate);
    }
    for (const key of ['residential', 'commercial', 'industrial'] as const) {
      const slider = this.sectorSliders[key];
      if (!slider.matches(':active')) {
        slider.value = String(rates[key]);
        this.sectorRateEls[key].textContent = `${rates[key]}%`;
        this.applyTag(this.sectorTagEls[key], rates[key]);
      }
    }

    // Scale revenue/expense figures by cadence (per-tick vs per-day)
    const mult = this.cadence === 'day' ? TICKS_PER_GAME_DAY : 1;
    const useDecimals = this.cadence === 'tick';
    const unitLabel = this.cadence === 'day' ? '/day' : '/tick';
    const totalOutflow = expenses.total + loanPayments;
    const net = taxes.total - totalOutflow;

    this.bodyEl.innerHTML = '';

    // Revenue section
    this.bodyEl.appendChild(this.createSectionHeader(`Revenue (${unitLabel})`));
    this.bodyEl.appendChild(this.createRow('Residential Tax', signedMoney(taxes.residents * mult, useDecimals), 'positive'));
    this.bodyEl.appendChild(this.createRow('Commercial Tax', signedMoney(taxes.commercial * mult, useDecimals), 'positive'));
    this.bodyEl.appendChild(this.createRow('Industrial Tax', signedMoney(taxes.industrial * mult, useDecimals), 'positive'));
    if (taxes.subsidy > 0) {
      this.bodyEl.appendChild(this.createRow('Small-Town Grant', signedMoney(taxes.subsidy * mult, useDecimals), 'positive'));
    }
    this.bodyEl.appendChild(this.createRow('Total Revenue', signedMoney(taxes.total * mult, useDecimals), 'positive', true));

    // Expenses section
    this.bodyEl.appendChild(this.createSectionHeader(`Expenses (${unitLabel})`));
    if (expenses.utilities > 0) {
      this.bodyEl.appendChild(this.createRow('Utilities (Power/Water/Sewage)', `-${money(expenses.utilities * mult, useDecimals)}`, 'negative'));
    }
    if (expenses.safety > 0) {
      this.bodyEl.appendChild(this.createRow('Safety (Police/Fire)', `-${money(expenses.safety * mult, useDecimals)}`, 'negative'));
    }
    if (expenses.civic > 0) {
      this.bodyEl.appendChild(this.createRow('Civic, Health & Education', `-${money(expenses.civic * mult, useDecimals)}`, 'negative'));
    }
    if (expenses.roads > 0) {
      this.bodyEl.appendChild(this.createRow('Roads & Transit', `-${money(expenses.roads * mult, useDecimals)}`, 'negative'));
    }
    if (expenses.zones > 0) {
      this.bodyEl.appendChild(this.createRow('District Servicing', `-${money(expenses.zones * mult, useDecimals)}`, 'negative'));
    }
    if (loanPayments > 0) {
      this.bodyEl.appendChild(this.createRow('Loan Repayments', `-${money(loanPayments * mult, useDecimals)}`, 'negative'));
    }
    this.bodyEl.appendChild(this.createRow('Total Expenses', `-${money(totalOutflow * mult, useDecimals)}`, 'negative', true));

    // Summary section
    const sep = document.createElement('div');
    sep.className = 'finance-separator';
    this.bodyEl.appendChild(sep);

    this.bodyEl.appendChild(
      this.createRow(`Net Cashflow ${unitLabel}`, signedMoney(net * mult, useDecimals), net >= 0 ? 'positive' : 'negative', true),
    );
    this.bodyEl.appendChild(this.createRow('Treasury', money(res.money), res.money < 0 ? 'negative' : undefined, true));
    this.bodyEl.appendChild(
      this.createRow(
        'Jobs / Workers',
        `${Math.round(labor.jobs).toLocaleString()} / ${Math.round(labor.workers).toLocaleString()}`,
        labor.employmentRate < 0.87 ? 'negative' : undefined,
      ),
    );
    if (debt > 0) {
      this.bodyEl.appendChild(this.createRow('Owed on Loans', money(debt), 'negative'));
    }

    this.renderLoans(res.loans ?? [], res.money);
    this.refreshQuote();
  }

  private renderMilestoneCard(population: number, claimed: string[]): void {
    const evalResult = evaluateMilestones(population, claimed);
    const next = evalResult.nextMilestone;
    if (!next) {
      this.milestoneEl.innerHTML = `
        <div class="finance-milestone-row">
          <span class="finance-milestone-title">All municipal charters earned</span>
          <span class="finance-milestone-grant">Metropolis</span>
        </div>
      `;
      return;
    }

    const pct = Math.max(0, Math.min(100, (population / next.population) * 100));
    this.milestoneEl.innerHTML = `
      <div class="finance-milestone-row">
        <span class="finance-milestone-title">Next: ${next.label} (${Math.floor(population).toLocaleString()} / ${next.population.toLocaleString()} pop)</span>
        <span class="finance-milestone-grant">+${money(next.grant)}</span>
      </div>
      <div class="finance-milestone-track">
        <div class="finance-milestone-fill" style="width:${pct.toFixed(1)}%"></div>
      </div>
    `;
  }

  private createSectionHeader(text: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'finance-section-heading';
    el.textContent = text;
    return el;
  }

  private createRow(label: string, value: string, colorClass?: string, bold = false): HTMLDivElement {
    const row = document.createElement('div');
    row.className = bold ? 'finance-row finance-row-total' : 'finance-row';
    const labelEl = document.createElement('span');
    labelEl.className = 'finance-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'finance-value';
    if (colorClass) valueEl.classList.add(`finance-${colorClass}`);
    valueEl.textContent = value;
    row.append(labelEl, valueEl);
    return row;
  }

  private renderLoans(loans: Loan[], treasury: number): void {
    this.loansEl.innerHTML = '';
    if (loans.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'finance-loan-empty';
      empty.textContent = 'No active loans.';
      this.loansEl.appendChild(empty);
      return;
    }

    for (const loan of loans) {
      const item = document.createElement('div');
      item.className = 'finance-loan-item';

      const info = document.createElement('div');
      info.className = 'finance-loan-info';
      const main = document.createElement('div');
      main.className = 'finance-loan-main';
      main.textContent = `${money(loan.remaining)} left of ${money(loan.totalDue)}`;
      const daysLeft = Math.ceil(loan.remaining / loan.paymentPerTick / TICKS_PER_GAME_DAY);
      const detail = document.createElement('div');
      detail.className = 'finance-loan-detail';
      detail.textContent =
        `${money(loan.paymentPerTick * TICKS_PER_GAME_DAY)}/day · about ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;

      const track = document.createElement('div');
      track.className = 'finance-loan-track';
      const fill = document.createElement('div');
      fill.className = 'finance-loan-fill';
      fill.style.width = `${Math.max(0, Math.min(100, (1 - loan.remaining / loan.totalDue) * 100))}%`;
      track.appendChild(fill);
      info.append(main, detail, track);

      const repayBtn = document.createElement('button');
      repayBtn.className = 'finance-loan-repay';
      repayBtn.textContent = 'Repay now';
      const canRepay = treasury >= loan.remaining;
      repayBtn.disabled = !canRepay || this.busy;
      repayBtn.title = canRepay
        ? `Pay the remaining ${money(loan.remaining)} from the treasury`
        : `Needs ${money(loan.remaining)} in the treasury`;
      repayBtn.addEventListener('click', () => this.repayLoan(loan.id));

      item.append(info, repayBtn);
      this.loansEl.appendChild(item);
    }
  }

  /** Recompute slider bounds, credit-adjusted term rates, quote, and availability. */
  private refreshQuote(): void {
    if (!this.state) return;
    const available = getAvailableCredit(this.state);
    const loanCount = (this.state.resources.loans ?? []).length;

    this.amountSlider.max = String(Math.max(LOAN_MIN_AMOUNT, available));
    if (Number(this.amountSlider.value) > available) {
      this.amountSlider.value = String(Math.max(LOAN_MIN_AMOUNT, available));
    }
    const amount = Number(this.amountSlider.value);
    this.amountLabel.textContent = money(amount);
    this.creditEl.textContent = `Credit available: ${money(available)} (scales with pop & tax base)`;

    for (const btn of this.termBtns) {
      const days = Number(btn.dataset.days);
      btn.classList.toggle('active', days === this.selectedTermDays);
      const q = quoteLoan(amount, days, this.state);
      const rateEl = btn.querySelector('.finance-term-rate');
      if (q && rateEl) {
        rateEl.textContent = `${(q.interestRate * 100).toFixed(1).replace(/\.0$/, '')}%`;
      }
    }

    const quote = quoteLoan(amount, this.selectedTermDays, this.state);
    const check = validateLoanRequest(this.state, amount, this.selectedTermDays);
    this.amountSlider.disabled = available < LOAN_MIN_AMOUNT || loanCount >= MAX_ACTIVE_LOANS;

    this.quoteEl.innerHTML = '';
    if (quote) {
      this.quoteEl.append(
        this.createRow('Interest', `${money(quote.interest)} (${(quote.interestRate * 100).toFixed(1).replace(/\.0$/, '')}%)`),
        this.createRow('Total to repay', money(quote.totalDue)),
        this.createRow('Repayment', `${money(quote.paymentPerDay)}/day (${quote.paymentPerTick.toFixed(1)}/tick)`),
      );
    }

    this.takeBtn.textContent = this.busy ? 'Working…' : `Take ${money(amount)} loan`;
    this.takeBtn.disabled = this.busy || !check.valid || !this.callbacks;
    if (!check.valid) {
      this.setStatus(check.reason ?? 'This loan is not available', true);
    } else if (this.statusEl.classList.contains('error')) {
      this.setStatus('');
    }
  }

  private setStatus(text: string, isError = false): void {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('error', isError);
  }

  private async takeLoan(): Promise<void> {
    if (this.busy || !this.callbacks || !this.state) return;
    const amount = Number(this.amountSlider.value);
    await this.run(
      () => this.callbacks!.onTakeLoan(amount, this.selectedTermDays),
      `${money(amount)} added to the treasury.`,
    );
  }

  private async repayLoan(loanId: string): Promise<void> {
    if (this.busy || !this.callbacks) return;
    await this.run(() => this.callbacks!.onRepayLoan(loanId), 'Loan repaid.');
  }

  private async run(
    action: () => Promise<{ success: boolean; error?: string }>,
    successText: string,
  ): Promise<void> {
    this.busy = true;
    this.refreshQuote();
    let message = successText;
    let failed = false;
    try {
      const result = await action();
      if (!result.success) {
        failed = true;
        message = result.error ?? 'The bank declined.';
      }
    } catch {
      failed = true;
      message = 'Could not reach the server.';
    }
    this.busy = false;
    if (this.state) this.update(this.state);
    this.setStatus(message, failed);
  }

  toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  show(): void {
    this.visible = true;
    this.setStatus('');
    this.overlay.style.display = 'flex';
  }

  hide(): void {
    this.visible = false;
    this.overlay.style.display = 'none';
  }

  isVisible(): boolean {
    return this.visible;
  }
}

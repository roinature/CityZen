import type { CityState, Loan } from '@cityzen/shared';
import {
  calculateTaxBreakdown,
  calculateLaborStats,
  calculateMaintenance,
  calculateLoanPayments,
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
} from '@cityzen/shared';

export interface FinancePanelCallbacks {
  onTaxRateChange: (rate: number) => void;
  onTakeLoan: (amount: number, termDays: number) => Promise<{ success: boolean; error?: string }>;
  onRepayLoan: (loanId: string) => Promise<{ success: boolean; error?: string }>;
}

function money(value: number): string {
  const rounded = Math.round(value);
  return `${rounded < 0 ? '-' : ''}$${Math.abs(rounded).toLocaleString()}`;
}

function signedMoney(value: number): string {
  const rounded = Math.round(value);
  return `${rounded < 0 ? '-' : '+'}$${Math.abs(rounded).toLocaleString()}`;
}

export class FinancePanel {
  private overlay: HTMLDivElement;
  private taxSlider!: HTMLInputElement;
  private taxRateEl!: HTMLSpanElement;
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

    const header = document.createElement('h2');
    header.textContent = 'City Finances';
    panel.appendChild(header);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'finance-body';
    panel.appendChild(this.renderTaxControls());
    panel.appendChild(this.bodyEl);

    panel.appendChild(this.renderLoanSection());

    const closeBtn = document.createElement('button');
    closeBtn.className = 'menu-btn';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => this.hide());
    panel.appendChild(closeBtn);

    this.overlay.appendChild(panel);
  }

  private renderTaxControls(): HTMLDivElement {
    const controls = document.createElement('div');
    controls.className = 'finance-tax-controls';
    controls.innerHTML = `
      <label class="finance-row" for="tax-slider">
        <span>Tax rate</span>
        <span class="finance-value" id="finance-tax-rate"></span>
      </label>
      <input type="range" id="tax-slider" class="finance-loan-slider"
        min="${MIN_TAX_RATE}" max="${MAX_TAX_RATE}" step="${TAX_RATE_STEP}"
        aria-describedby="finance-tax-hint" />
      <p id="finance-tax-hint">Taxes above ${TAX_COMFORT_RATE}% lower happiness.</p>
    `;
    this.taxRateEl = controls.querySelector('#finance-tax-rate')!;
    this.taxSlider = controls.querySelector('#tax-slider')!;
    this.taxSlider.addEventListener('input', () => {
      this.taxRateEl.textContent = `${this.taxSlider.value}%`;
    });
    this.taxSlider.addEventListener('change', () => {
      this.callbacks?.onTaxRateChange(this.taxSlider.valueAsNumber);
    });
    return controls;
  }

  private renderLoanSection(): HTMLDivElement {
    const section = document.createElement('div');
    section.className = 'finance-loans';

    const title = document.createElement('h3');
    title.textContent = 'Loans';
    section.appendChild(title);

    // Active loans (re-rendered on every update)
    this.loansEl = document.createElement('div');
    this.loansEl.className = 'finance-loan-list';
    section.appendChild(this.loansEl);

    // New loan form (built once so the slider keeps its position between ticks)
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
      days.textContent = `${term.days} days`;
      const rate = document.createElement('span');
      rate.className = 'finance-term-rate';
      rate.textContent = `${Math.round(term.interestRate * 100)}% interest`;
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
    const taxes = calculateTaxBreakdown(state);
    const revenue = taxes.total;
    const labor = calculateLaborStats(state);
    const maintenance = calculateMaintenance(state);
    const loanPayments = calculateLoanPayments(state.resources);
    const net = revenue - maintenance - loanPayments;
    const res = state.resources;
    const debt = getOutstandingDebt(res);
    if (!this.taxSlider.matches(':active')) {
      this.taxSlider.value = String(res.taxRate);
      this.taxRateEl.textContent = `${res.taxRate}%`;
    }

    const rows: [string, string, string?][] = [
      ['Population', res.population.toLocaleString()],
      ['Happiness', `${Math.round(res.happiness)}%`],
      ['', ''],
      ['Jobs / Workers', `${Math.round(labor.jobs).toLocaleString()} / ${Math.round(labor.workers).toLocaleString()}`,
        labor.employmentRate < 0.87 ? 'negative' : undefined],
      ['', ''],
      ['Resident Taxes', signedMoney(Math.round(taxes.residents)), 'positive'],
      ['Business Taxes', signedMoney(Math.round(taxes.businesses)), 'positive'],
      ['Tax Revenue', signedMoney(revenue), 'positive'],
      ['Maintenance', `-${money(maintenance)}`, 'negative'],
    ];
    if (loanPayments > 0) {
      rows.push(['Loan Repayments', `-${money(loanPayments)}`, 'negative']);
    }
    rows.push(
      ['Net Income / tick', signedMoney(net), net >= 0 ? 'positive' : 'negative'],
      ['', ''],
      ['Treasury', money(res.money), res.money < 0 ? 'negative' : undefined],
    );
    if (debt > 0) {
      rows.push(['Owed on Loans', money(debt), 'negative']);
    }
    rows.push(['Buildings', String(state.buildings.length)]);

    this.bodyEl.innerHTML = '';
    for (const [label, value, colorClass] of rows) {
      if (!label && !value) {
        const sep = document.createElement('div');
        sep.className = 'finance-separator';
        this.bodyEl.appendChild(sep);
        continue;
      }
      this.bodyEl.appendChild(this.createRow(label, value, colorClass));
    }

    this.renderLoans(res.loans ?? [], res.money);
    this.refreshQuote();
  }

  private createRow(label: string, value: string, colorClass?: string): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'finance-row';
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

  /** Recompute slider bounds, the quote and whether the loan can be taken. */
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
    this.creditEl.textContent = `Credit available: ${money(available)} (grows with population)`;

    for (const btn of this.termBtns) {
      btn.classList.toggle('active', Number(btn.dataset.days) === this.selectedTermDays);
    }

    const quote = quoteLoan(amount, this.selectedTermDays);
    const check = validateLoanRequest(this.state, amount, this.selectedTermDays);
    this.amountSlider.disabled = available < LOAN_MIN_AMOUNT || loanCount >= MAX_ACTIVE_LOANS;

    this.quoteEl.innerHTML = '';
    if (quote) {
      this.quoteEl.append(
        this.createRow('Interest', money(quote.interest)),
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

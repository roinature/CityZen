import type { CityState } from '../types/city.js';
import type { Loan, ResourceState } from '../types/resources.js';
import {
  LOAN_TERMS,
  LOAN_MIN_AMOUNT,
  LOAN_AMOUNT_STEP,
  LOAN_BASE_CREDIT_LIMIT,
  LOAN_CREDIT_PER_CITIZEN,
  MAX_ACTIVE_LOANS,
} from '../constants/economy.js';
import { TICKS_PER_GAME_DAY } from '../constants/simulation.js';

export interface LoanQuote {
  amount: number;
  termDays: number;
  /** Flat interest over the whole term, e.g. 0.1 = 10%. */
  interestRate: number;
  interest: number;
  totalDue: number;
  paymentPerTick: number;
  paymentPerDay: number;
}

/** Total the city may owe at once. Grows with population: bigger cities are better credit. */
export function getCreditLimit(state: CityState): number {
  const raw = LOAN_BASE_CREDIT_LIMIT + state.resources.population * LOAN_CREDIT_PER_CITIZEN;
  return Math.floor(raw / LOAN_AMOUNT_STEP) * LOAN_AMOUNT_STEP;
}

/** Everything still owed across all loans (principal + interest). */
export function getOutstandingDebt(resources: ResourceState): number {
  return (resources.loans ?? []).reduce((sum, loan) => sum + loan.remaining, 0);
}

/** How much more the city can borrow right now, rounded down to the amount step. */
export function getAvailableCredit(state: CityState): number {
  const available = getCreditLimit(state) - getOutstandingDebt(state.resources);
  return Math.max(0, Math.floor(available / LOAN_AMOUNT_STEP) * LOAN_AMOUNT_STEP);
}

/** Scheduled repayments per tick across all loans. */
export function calculateLoanPayments(resources: ResourceState): number {
  return (resources.loans ?? []).reduce(
    (sum, loan) => sum + Math.min(loan.paymentPerTick, loan.remaining),
    0,
  );
}

/** Price a loan for the chosen amount and term. Returns null for a term that isn't offered. */
export function quoteLoan(amount: number, termDays: number): LoanQuote | null {
  const term = LOAN_TERMS.find(t => t.days === termDays);
  if (!term) return null;

  const interest = Math.round(amount * term.interestRate);
  const totalDue = amount + interest;
  const paymentPerTick = totalDue / (termDays * TICKS_PER_GAME_DAY);

  return {
    amount,
    termDays,
    interestRate: term.interestRate,
    interest,
    totalDue,
    paymentPerTick,
    paymentPerDay: paymentPerTick * TICKS_PER_GAME_DAY,
  };
}

export function validateLoanRequest(
  state: CityState,
  amount: number,
  termDays: number,
): { valid: boolean; reason?: string } {
  if (!Number.isFinite(amount) || amount < LOAN_MIN_AMOUNT || amount % LOAN_AMOUNT_STEP !== 0) {
    return { valid: false, reason: `Loans start at $${LOAN_MIN_AMOUNT} in steps of $${LOAN_AMOUNT_STEP}` };
  }
  if (!quoteLoan(amount, termDays)) {
    return { valid: false, reason: 'That loan term is not offered' };
  }
  if ((state.resources.loans ?? []).length >= MAX_ACTIVE_LOANS) {
    return { valid: false, reason: `The city already has ${MAX_ACTIVE_LOANS} loans — repay one first` };
  }
  if (amount > getAvailableCredit(state)) {
    return { valid: false, reason: 'That is more than the bank will lend this city' };
  }
  return { valid: true };
}

export function createLoan(id: string, amount: number, termDays: number, tick: number): Loan {
  const quote = quoteLoan(amount, termDays)!;
  return {
    id,
    principal: amount,
    interestRate: quote.interestRate,
    termDays,
    totalDue: quote.totalDue,
    remaining: quote.totalDue,
    paymentPerTick: quote.paymentPerTick,
    takenAtTick: tick,
  };
}

/**
 * Pay this tick's instalments out of `availableMoney`.
 *
 * A payment the treasury can't cover is not forgiven: the unpaid part stays on
 * the loan, so a broke city simply takes longer to clear its debt.
 */
export function applyLoanPayments(
  loans: Loan[],
  availableMoney: number,
): { loans: Loan[]; paid: number } {
  let budget = Math.max(0, availableMoney);
  let paid = 0;
  const next: Loan[] = [];

  for (const loan of loans) {
    const due = Math.min(loan.paymentPerTick, loan.remaining);
    const payment = Math.min(due, budget);
    budget -= payment;
    paid += payment;

    const remaining = loan.remaining - payment;
    // Drop loans that are fully repaid (tolerate floating-point dust)
    if (remaining > 0.005) {
      next.push({ ...loan, remaining });
    }
  }

  return { loans: next, paid };
}

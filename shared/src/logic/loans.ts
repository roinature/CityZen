import type { CityState } from '../types/city.js';
import type { CreditRating, Loan, ResourceState } from '../types/resources.js';
import {
  LOAN_TERMS,
  LOAN_MIN_AMOUNT,
  LOAN_AMOUNT_STEP,
  LOAN_BASE_CREDIT_LIMIT,
  LOAN_CREDIT_PER_CITIZEN,
  LOAN_CREDIT_REVENUE_MULT,
  MAX_ACTIVE_LOANS,
  CREDIT_RATING_RATE_MULT,
} from '../constants/economy.js';
import { TICKS_PER_GAME_DAY } from '../constants/simulation.js';
import { calculateNetIncome, calculateTaxRevenue } from './resources.js';

export interface LoanQuote {
  amount: number;
  termDays: number;
  /** Flat interest over the whole term, e.g. 0.1 = 10%. Adjusted by credit rating when state is provided. */
  interestRate: number;
  interest: number;
  totalDue: number;
  paymentPerTick: number;
  paymentPerDay: number;
  creditRating?: CreditRating;
}

export interface CreditAssessment {
  rating: CreditRating;
  score: number;
  rateMultiplier: number;
}

/**
 * Evaluate the city's municipal creditworthiness (AAA down to B)
 * based on cashflow health, treasury reserve, debt load, and city scale.
 */
export function calculateCreditRating(state: CityState): CreditAssessment {
  let score = 70; // Baseline 'A'

  const net = calculateNetIncome(state) - calculateLoanPayments(state.resources);
  if (net >= 40) score += 15;
  else if (net >= 10) score += 8;
  else if (net < -20) score -= 22;
  else if (net < 0) score -= 10;

  if (state.resources.money < 0) {
    score -= 25;
  } else if (state.resources.money >= 25_000) {
    score += 10;
  } else if (state.resources.money >= 10_000) {
    score += 5;
  }

  const limit = getCreditLimit(state);
  const debtRatio = limit > 0 ? getOutstandingDebt(state.resources) / limit : 0;
  if (debtRatio > 0.75) score -= 18;
  else if (debtRatio > 0.45) score -= 8;

  if (state.resources.population >= 350) score += 5;

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  let rating: CreditRating;
  if (clamped >= 90) rating = 'AAA';
  else if (clamped >= 80) rating = 'AA';
  else if (clamped >= 68) rating = 'A';
  else if (clamped >= 55) rating = 'BBB';
  else if (clamped >= 40) rating = 'BB';
  else rating = 'B';

  return { rating, score: clamped, rateMultiplier: CREDIT_RATING_RATE_MULT[rating] };
}

/** Total the city may owe at once. Grows with population and tax base. */
export function getCreditLimit(state: CityState): number {
  const taxRev = calculateTaxRevenue(state);
  const raw = LOAN_BASE_CREDIT_LIMIT
    + state.resources.population * LOAN_CREDIT_PER_CITIZEN
    + taxRev * LOAN_CREDIT_REVENUE_MULT;
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
export function quoteLoan(amount: number, termDays: number, state?: CityState): LoanQuote | null {
  const term = LOAN_TERMS.find(t => t.days === termDays);
  if (!term) return null;

  const credit = state ? calculateCreditRating(state) : null;
  const effectiveRate = credit
    ? Math.round(term.interestRate * credit.rateMultiplier * 1000) / 1000
    : term.interestRate;

  const interest = Math.round(amount * effectiveRate);
  const totalDue = amount + interest;
  const paymentPerTick = totalDue / (termDays * TICKS_PER_GAME_DAY);

  return {
    amount,
    termDays,
    interestRate: effectiveRate,
    interest,
    totalDue,
    paymentPerTick,
    paymentPerDay: paymentPerTick * TICKS_PER_GAME_DAY,
    ...(credit ? { creditRating: credit.rating } : {}),
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
  if (!quoteLoan(amount, termDays, state)) {
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

export function createLoan(
  id: string,
  amount: number,
  termDays: number,
  tick: number,
  state?: CityState,
): Loan {
  const quote = quoteLoan(amount, termDays, state)!;
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

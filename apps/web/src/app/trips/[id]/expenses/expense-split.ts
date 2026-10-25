// The pure parts of the expense form: how a split is divided, and how an
// existing expense becomes the form's starting state when editing it. Kept free
// of React so it can be tested under plain Node (scripts/expense-split.test.mjs).
import type { Expense, TripMember } from '@/lib/api';

/** A member as the form lists them; `left` marks someone on the expense who is no longer on the trip. */
export type FormMember = TripMember & { left?: boolean };

/**
 * Mirrors `ExpensesService.splitEqually` on the API: whole units only, with
 * the remainder handed out one unit at a time to the first people listed, so
 * the preview shown here is exactly what gets stored.
 */
export function splitEqually(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  let remainder = total - base * count;
  return Array.from({ length: count }, () => {
    const share = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
    return share;
  });
}

/**
 * Everyone the form should offer when editing: the trip's current members, plus
 * anyone already on this expense who has since left. The server lets them stay
 * on an expense they were part of (otherwise fixing a typo would be impossible
 * once someone left), but never lets anyone new in from outside the trip.
 */
export function formMembers(expense: Expense, approved: TripMember[]): FormMember[] {
  const present = new Set(approved.map((m) => m.userId));
  const extra = new Map<string, FormMember>();
  for (const user of [expense.paidBy, ...expense.splits.map((s) => s.user)]) {
    if (!present.has(user.id) && !extra.has(user.id)) {
      extra.set(user.id, { id: `left-${user.id}`, userId: user.id, role: 'MEMBER', user, left: true });
    }
  }
  return [...approved, ...extra.values()];
}

export interface FormState {
  description: string;
  amountText: string;
  category: string;
  paidById: string;
  /** Ids of the people sharing it. */
  included: string[];
  /** True when the shares aren't an equal split, so the form opens in manual mode. */
  custom: boolean;
  customText: Record<string, string>;
}

/** The form's starting values for editing `expense`. */
export function stateFromExpense(expense: Expense, members: FormMember[]): FormState {
  const amountByUser = new Map(expense.splits.map((s) => [s.userId, s.amount]));
  // In the form's own order, since that is the order the remainder is handed out in.
  const people = members.filter((m) => amountByUser.has(m.userId));
  const equal = splitEqually(expense.amount, people.length);
  const custom = people.some((m, i) => amountByUser.get(m.userId) !== equal[i]);

  return {
    description: expense.description,
    amountText: String(expense.amount),
    category: expense.category ?? '',
    paidById: expense.paidById,
    included: people.map((m) => m.userId),
    custom,
    customText: custom ? Object.fromEntries(people.map((m) => [m.userId, String(amountByUser.get(m.userId))])) : {},
  };
}

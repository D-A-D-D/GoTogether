// Who may change an expense, and when it is too late to. Pure, so the rules can
// be tested without a database (see expense-rules.spec.ts).

export interface ChangeableExpense {
  paidById: string;
  /** Who entered it. Null on expenses logged before this was recorded. */
  createdById: string | null;
  splits: ReadonlyArray<{ userId: string; settled: boolean }>;
}

/** 'ok', or why not: `not-yours` (neither logged nor paid it) or `settled` (money has already been marked as changing hands). */
export type ChangeVerdict = 'ok' | 'not-yours' | 'settled';

/**
 * An expense can be edited or deleted by the person who logged it or the person
 * who paid it — and only until any share of it is marked paid. After that the
 * "settled" markers would no longer mean what the people who set them thought,
 * so the fix is to log a correcting expense instead.
 */
export function changeVerdict(expense: ChangeableExpense, userId: string): ChangeVerdict {
  const isTheirs = expense.paidById === userId || expense.createdById === userId;
  if (!isTheirs) return 'not-yours';
  if (expense.splits.some((split) => split.settled)) return 'settled';
  return 'ok';
}

/** Everyone with a stake in the expense: the payer and each person with a share. */
export function involvedUserIds(expense: Pick<ChangeableExpense, 'paidById' | 'splits'>): string[] {
  return [...new Set([expense.paidById, ...expense.splits.map((split) => split.userId)])];
}

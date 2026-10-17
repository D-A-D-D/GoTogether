'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, type CreateExpenseInput, type TripMember } from '@/lib/api';
import { ErrorText, Label, PrimaryButton, Select, TextInput } from '@/components/form-controls';

const CATEGORIES = ['Food', 'Transport', 'Stay', 'Activities', 'Other'];

const WHOLE_NUMBER = /^\d+$/;

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

interface ExpenseFormProps {
  members: TripMember[];
  meId: string;
  /** Rejects with an ApiError when the server refuses the expense. */
  onSubmit: (input: CreateExpenseInput) => Promise<void>;
}

export function ExpenseForm({ members, meId, onSubmit }: ExpenseFormProps) {
  const [description, setDescription] = useState('');
  const [amountText, setAmountText] = useState('');
  const [category, setCategory] = useState('');
  const [paidById, setPaidById] = useState(meId);
  const [included, setIncluded] = useState<Set<string>>(() => new Set(members.map((m) => m.userId)));
  const [custom, setCustom] = useState(false);
  const [customText, setCustomText] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const amount = WHOLE_NUMBER.test(amountText) ? Number(amountText) : NaN;
  const people = members.filter((m) => included.has(m.userId));
  const equalShares = amount >= 1 && people.length > 0 ? splitEqually(amount, people.length) : [];
  const customShares = people.map((m) => {
    const text = customText[m.userId] ?? '';
    return WHOLE_NUMBER.test(text) ? Number(text) : 0;
  });
  const customSum = customShares.reduce((sum, n) => sum + n, 0);

  // Only worth flagging once there's an amount to split.
  let splitProblem: string | null = null;
  if (amount >= 1) {
    if (people.length === 0) {
      splitProblem = 'Pick at least one person to split with.';
    } else if (!custom && amount < people.length) {
      splitProblem = 'That amount is too small to split between this many people — deselect some.';
    } else if (custom && customShares.some((share) => share < 1)) {
      splitProblem = 'Everyone included needs a share of at least 1 — deselect anyone who owes nothing.';
    } else if (custom && customSum !== amount) {
      const diff = amount - customSum;
      splitProblem =
        diff > 0 ? `${diff} still to assign — shares need to add up to ${amount}.` : `${-diff} over — shares need to add up to ${amount}.`;
    }
  }

  const valid = description.trim().length > 0 && amount >= 1 && people.length > 0 && splitProblem === null;

  function toggleIncluded(userId: string) {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function handleToggleCustom() {
    if (!custom) {
      // Start from the equal split so the user only has to nudge numbers.
      const seeded: Record<string, string> = {};
      people.forEach((m, i) => {
        if (equalShares[i] !== undefined) seeded[m.userId] = String(equalShares[i]);
      });
      setCustomText(seeded);
    }
    setCustom((prev) => !prev);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid || submitting) return;
    setError(null);
    setSubmitting(true);

    const base = {
      description: description.trim(),
      amount,
      paidById,
      ...(category.trim() ? { category: category.trim() } : {}),
    };
    const input: CreateExpenseInput = custom
      ? { ...base, splits: people.map((m, i) => ({ userId: m.userId, amount: customShares[i] })) }
      : { ...base, splitUserIds: people.map((m) => m.userId) };

    try {
      await onSubmit(input);
      // Paid-by and who's included carry over (batches of expenses are
      // usually the same group); the rest would silently mislabel the next one.
      setDescription('');
      setAmountText('');
      setCategory('');
      setCustomText({});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add that expense.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <div>
          <Label htmlFor="expense-description">What was it for?</Label>
          <TextInput
            id="expense-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Dinner at the dhaba"
            maxLength={200}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="expense-amount">Amount</Label>
          <TextInput
            id="expense-amount"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value.trim())}
            inputMode="numeric"
            placeholder="1200"
            className="mt-1"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="expense-paid-by">Paid by</Label>
          <Select
            id="expense-paid-by"
            value={paidById}
            onChange={(e) => setPaidById(e.target.value)}
            className="mt-1"
          >
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.userId === meId ? `${m.user.name} (you)` : m.user.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="expense-category">Category (optional)</Label>
          <TextInput
            id="expense-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            list="expense-categories"
            maxLength={60}
            className="mt-1"
          />
          <datalist id="expense-categories">
            {CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
      </div>

      <fieldset>
        <div className="flex items-center justify-between">
          <legend className="text-sm font-medium text-foreground/80">Split between</legend>
          <button
            type="button"
            onClick={handleToggleCustom}
            className="text-xs text-foreground/60 underline-offset-2 hover:text-foreground hover:underline"
          >
            {custom ? 'Split equally instead' : 'Set amounts manually'}
          </button>
        </div>
        <ul className="mt-2 flex flex-col gap-2">
          {members.map((m) => {
            const index = people.findIndex((p) => p.userId === m.userId);
            const isIncluded = index !== -1;
            return (
              <li key={m.userId} className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isIncluded}
                    onChange={() => toggleIncluded(m.userId)}
                    className="accent-accent"
                  />
                  {m.userId === meId ? `${m.user.name} (you)` : m.user.name}
                </label>
                {isIncluded &&
                  (custom ? (
                    <TextInput
                      aria-label={`Share for ${m.user.name}`}
                      value={customText[m.userId] ?? ''}
                      onChange={(e) => setCustomText((prev) => ({ ...prev, [m.userId]: e.target.value.trim() }))}
                      inputMode="numeric"
                      className="w-24 text-right"
                    />
                  ) : (
                    <span className="text-sm tabular-nums text-foreground/60">
                      {equalShares[index] !== undefined ? equalShares[index] : '—'}
                    </span>
                  ))}
              </li>
            );
          })}
        </ul>
      </fieldset>

      {splitProblem && <p className="text-sm text-foreground/60">{splitProblem}</p>}
      <ErrorText>{error}</ErrorText>

      <PrimaryButton type="submit" disabled={!valid || submitting}>
        {submitting ? 'Adding…' : 'Add expense'}
      </PrimaryButton>
    </form>
  );
}

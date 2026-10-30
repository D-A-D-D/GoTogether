'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, type CreateExpenseInput, type Expense } from '@/lib/api';
import { ErrorText, Label, PrimaryButton, Select, TextInput } from '@/components/form-controls';
import { Button } from '@/components/ui';
import { splitEqually, stateFromExpense, type FormMember } from './expense-split';

const CATEGORIES = ['Food', 'Transport', 'Stay', 'Activities', 'Other'];

const WHOLE_NUMBER = /^\d+$/;

interface ExpenseFormProps {
  members: FormMember[];
  meId: string;
  /** Rejects with an ApiError when the server refuses the expense. */
  onSubmit: (input: CreateExpenseInput) => Promise<void>;
  /** Editing this expense rather than adding a new one: the form starts from it and keeps its values after saving. */
  initial?: Expense;
  /** Shown beside the save button, for forms that can be dismissed. */
  onCancel?: () => void;
  /** Keeps element ids unique when more than one form is on the page. */
  idPrefix?: string;
}

function memberLabel(m: FormMember, meId: string): string {
  if (m.userId === meId) return `${m.user.name} (you)`;
  return m.left ? `${m.user.name} (left the trip)` : m.user.name;
}

export function ExpenseForm({ members, meId, onSubmit, initial, onCancel, idPrefix = 'expense' }: ExpenseFormProps) {
  const start = initial ? stateFromExpense(initial, members) : null;
  const [description, setDescription] = useState(start?.description ?? '');
  const [amountText, setAmountText] = useState(start?.amountText ?? '');
  const [category, setCategory] = useState(start?.category ?? '');
  const [paidById, setPaidById] = useState(start?.paidById ?? meId);
  const [included, setIncluded] = useState<Set<string>>(
    () => new Set(start ? start.included : members.map((m) => m.userId)),
  );
  const [custom, setCustom] = useState(start?.custom ?? false);
  const [customText, setCustomText] = useState<Record<string, string>>(start?.customText ?? {});
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
      // When adding, paid-by and who's included carry over (batches of expenses
      // are usually the same group); the rest would silently mislabel the next
      // one. An edit just closes, so it keeps what was saved.
      if (!initial) {
        setDescription('');
        setAmountText('');
        setCategory('');
        setCustomText({});
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that expense.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <div>
          <Label htmlFor={`${idPrefix}-description`}>What was it for?</Label>
          <TextInput
            id={`${idPrefix}-description`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Dinner at the dhaba"
            maxLength={200}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-amount`}>Amount</Label>
          <TextInput
            id={`${idPrefix}-amount`}
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
          <Label htmlFor={`${idPrefix}-paid-by`}>Paid by</Label>
          <Select
            id={`${idPrefix}-paid-by`}
            value={paidById}
            onChange={(e) => setPaidById(e.target.value)}
            className="mt-1"
          >
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {memberLabel(m, meId)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-category`}>Category (optional)</Label>
          <TextInput
            id={`${idPrefix}-category`}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            list={`${idPrefix}-categories`}
            maxLength={60}
            className="mt-1"
          />
          <datalist id={`${idPrefix}-categories`}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
      </div>

      <fieldset>
        <div className="flex items-center justify-between">
          <legend className="text-[0.95rem] font-semibold">Split between</legend>
          <Button variant="ghost" size="sm" onClick={handleToggleCustom}>
            {custom ? 'Split equally instead' : 'Set amounts manually'}
          </Button>
        </div>
        <ul className="mt-2 flex flex-col gap-2">
          {members.map((m) => {
            const index = people.findIndex((p) => p.userId === m.userId);
            const isIncluded = index !== -1;
            return (
              <li key={m.userId} className="flex min-h-12 items-center justify-between gap-3">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={isIncluded}
                    onChange={() => toggleIncluded(m.userId)}
                    className="h-6 w-6 shrink-0 accent-accent"
                  />
                  {memberLabel(m, meId)}
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
                    <span className="font-semibold tabular-nums">
                      {equalShares[index] !== undefined ? equalShares[index] : '—'}
                    </span>
                  ))}
              </li>
            );
          })}
        </ul>
      </fieldset>

      {splitProblem && <p className="rounded-xl bg-accent-soft px-4 py-2.5 text-[0.95rem] font-medium">{splitProblem}</p>}
      <ErrorText>{error}</ErrorText>

      <div className="flex items-center gap-3">
        <PrimaryButton type="submit" disabled={!valid || submitting}>
          {submitting ? 'Saving…' : initial ? 'Save changes' : 'Add expense'}
        </PrimaryButton>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useRequireAuth } from '@/lib/use-require-auth';
import {
  ApiError,
  createExpense,
  deleteExpense,
  getBalances,
  listExpenses,
  listTripMembers,
  settleSplit,
  updateExpense,
  type Balances,
  type CreateExpenseInput,
  type Expense,
  type TripMember,
} from '@/lib/api';
import { ErrorText } from '@/components/form-controls';
import { ExpenseForm } from './expense-form';
import { formMembers } from './expense-split';

const amountFormat = new Intl.NumberFormat('en');
const dateFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });

export default function TripExpensesPage() {
  const authStatus = useRequireAuth();
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  const tripId = params.id;

  const [members, setMembers] = useState<TripMember[] | null>(null);
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [loadedMembers, loadedExpenses, loadedBalances] = await Promise.all([
        listTripMembers(tripId),
        listExpenses(tripId),
        getBalances(tripId),
      ]);
      setMembers(loadedMembers);
      setExpenses(loadedExpenses);
      setBalances(loadedBalances);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "Only approved members of this trip can see its expenses."
          : 'Could not load expenses.',
      );
    }
  }, [tripId]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    // Deferred a microtask so setState inside load() never happens
    // synchronously within the effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => load());
  }, [authStatus, load]);

  async function handleCreate(input: CreateExpenseInput) {
    await createExpense(tripId, input);
    await load();
  }

  async function handleUpdate(expenseId: string, input: CreateExpenseInput) {
    await updateExpense(tripId, expenseId, input);
    setEditingId(null);
    await load();
  }

  async function handleDelete(expenseId: string) {
    setActionError(null);
    setDeletingId(expenseId);
    try {
      await deleteExpense(tripId, expenseId);
      setConfirmingDeleteId(null);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not delete that expense.');
      // A settled share can have blocked it since the page loaded — show the real state.
      await load();
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSettle(expenseId: string, splitId: string) {
    setActionError(null);
    setSettlingId(splitId);
    try {
      await settleSplit(tripId, expenseId, splitId);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not mark that as paid.');
    } finally {
      setSettlingId(null);
    }
  }

  if (authStatus !== 'authenticated' || !user) return null;

  // A failed reload after the first successful load shouldn't blank the page.
  if (loadError && !balances) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-24">
        <ErrorText>{loadError}</ErrorText>
      </main>
    );
  }

  if (!members || !expenses || !balances) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-24">
        <p className="text-sm text-foreground/60">Loading expenses…</p>
      </main>
    );
  }

  const meId = user.id;
  const who = (person: { id: string; name: string }) => (person.id === meId ? 'You' : person.name);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <Link href={`/trips/${tripId}`} className="text-sm text-foreground/60 hover:text-foreground">
        &larr; Back to trip
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Expenses</h1>

      {loadError && (
        <div className="mt-4">
          <ErrorText>{loadError}</ErrorText>
        </div>
      )}

      <section className="mt-6 rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-medium text-foreground/80">Your balances</h2>
        {balances.balances.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/60">You&apos;re all settled up.</p>
        ) : (
          <>
            <div className="mt-2 flex gap-6 text-sm">
              <span>
                You&apos;re owed <strong className="text-accent">{amountFormat.format(balances.totalOwedToYou)}</strong>
              </span>
              <span>
                You owe <strong className="text-danger">{amountFormat.format(balances.totalYouOwe)}</strong>
              </span>
            </div>
            <ul className="mt-3 flex flex-col gap-1 text-sm text-foreground/80">
              {balances.balances.map((b) => (
                <li key={b.counterpart.id}>
                  {b.netAmount > 0
                    ? `${b.counterpart.name} owes you ${amountFormat.format(b.netAmount)}`
                    : `You owe ${b.counterpart.name} ${amountFormat.format(-b.netAmount)}`}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold tracking-tight">Add an expense</h2>
        <div className="mt-3 rounded-xl border border-line bg-surface p-4">
          <ExpenseForm members={members} meId={meId} onSubmit={handleCreate} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-tight">History</h2>
        <ErrorText>{actionError}</ErrorText>
        {expenses.length === 0 ? (
          <p className="mt-3 text-sm text-foreground/60">No expenses yet. Add the first one above.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {expenses.map((expense) => (
              <li key={expense.id} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{expense.description}</p>
                    <p className="mt-0.5 text-xs text-foreground/50">
                      Paid by {who(expense.paidBy)} &middot; {dateFormat.format(new Date(expense.createdAt))}
                      {expense.category ? ` · ${expense.category}` : ''}
                    </p>
                  </div>
                  <p className="shrink-0 font-semibold tabular-nums">{amountFormat.format(expense.amount)}</p>
                </div>
                {editingId === expense.id ? (
                  <div className="mt-3 border-t border-line pt-3">
                    <ExpenseForm
                      idPrefix={`edit-${expense.id}`}
                      members={formMembers(expense, members)}
                      meId={meId}
                      initial={expense}
                      onSubmit={(input) => handleUpdate(expense.id, input)}
                      onCancel={() => setEditingId(null)}
                    />
                  </div>
                ) : (
                  <>
                    <ul className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
                      {expense.splits.map((split) => {
                        const isPayersOwnShare = split.userId === expense.paidById;
                        const involvesMe = split.userId === meId || expense.paidById === meId;
                        return (
                          <li key={split.id} className="flex items-center justify-between gap-3 text-sm">
                            <span className="text-foreground/80">{who(split.user)}</span>
                            <span className="flex items-center gap-3">
                              <span className="tabular-nums">{amountFormat.format(split.amount)}</span>
                              {isPayersOwnShare ? (
                                <span className="text-xs text-foreground/40">paid</span>
                              ) : split.settled ? (
                                <span className="text-xs text-accent">settled</span>
                              ) : involvesMe ? (
                                <button
                                  type="button"
                                  onClick={() => handleSettle(expense.id, split.id)}
                                  disabled={settlingId !== null}
                                  className="rounded-full border border-line px-3 py-1 text-xs text-foreground/70 hover:border-accent/50 hover:text-foreground disabled:opacity-50"
                                >
                                  {settlingId === split.id ? 'Saving…' : 'Mark paid'}
                                </button>
                              ) : (
                                <span className="text-xs text-foreground/40">owes</span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {expense.canChange ? (
                      confirmingDeleteId === expense.id ? (
                        <div className="mt-3 border-t border-line pt-3 text-sm">
                          <p className="text-foreground/80">
                            Delete this expense? Everyone involved will be told, and it comes off the balances.
                          </p>
                          <div className="mt-2 flex items-center gap-4">
                            <button
                              type="button"
                              onClick={() => handleDelete(expense.id)}
                              disabled={deletingId !== null}
                              className="rounded-full border border-danger px-4 py-1.5 font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
                            >
                              {deletingId === expense.id ? 'Deleting…' : 'Yes, delete it'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingDeleteId(null)}
                              disabled={deletingId !== null}
                              className="text-foreground/60 underline hover:text-foreground disabled:opacity-50"
                            >
                              Keep it
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 flex items-center gap-4 border-t border-line pt-3 text-sm">
                          <button
                            type="button"
                            onClick={() => {
                              setActionError(null);
                              setConfirmingDeleteId(null);
                              setEditingId(expense.id);
                            }}
                            className="text-foreground/60 underline hover:text-foreground"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setActionError(null);
                              setConfirmingDeleteId(expense.id);
                            }}
                            className="text-foreground/60 underline hover:text-danger"
                          >
                            Delete
                          </button>
                        </div>
                      )
                    ) : (
                      (expense.createdById === meId || expense.paidById === meId) && (
                        <p className="mt-3 border-t border-line pt-3 text-xs text-foreground/50">
                          Part of this has been marked paid, so it can&apos;t be changed. Add a correcting expense instead.
                        </p>
                      )
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

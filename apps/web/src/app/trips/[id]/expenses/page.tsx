'use client';

import { useState } from 'react';
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
  type CreateExpenseInput,
} from '@/lib/api';
import { invalidateQueries, useQuery } from '@/lib/query';
import { formatMoney } from '@/lib/format';
import { ErrorText } from '@/components/form-controls';
import { Button, Card, Chip, EmptyState, Skeleton } from '@/components/ui';
import { UserAvatar } from '@/components/user-avatar';
import { IconPlus } from '@/components/icons';
import { ExpenseForm } from './expense-form';
import { formMembers } from './expense-split';

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

export default function TripExpensesPage() {
  const authStatus = useRequireAuth();
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  const tripId = params.id;

  // The three come together: balances are computed from the same expenses the list shows.
  const key = `trip:${tripId}:expenses`;
  const { data, error: loadError, refetch } = useQuery(
    key,
    async () => {
      const [members, expenses, balances] = await Promise.all([listTripMembers(tripId), listExpenses(tripId), getBalances(tripId)]);
      return { members, expenses, balances };
    },
    { enabled: authStatus === 'authenticated', staleMs: 10_000 },
  );

  const [adding, setAdding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    invalidateQueries(key);
    await refetch();
  }

  async function handleCreate(input: CreateExpenseInput) {
    await createExpense(tripId, input);
    setAdding(false);
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
  if (loadError && !data) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <ErrorText>
          {loadError instanceof ApiError && loadError.status === 403
            ? 'Only approved members of this trip can see its expenses.'
            : 'Could not load expenses.'}
        </ErrorText>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-8 pt-5" aria-busy="true" aria-label="Loading expenses">
        <Skeleton className="h-40 w-full !rounded-3xl" />
        <Skeleton className="mt-4 h-14 w-full !rounded-full" />
        <Skeleton className="mt-6 h-28 w-full !rounded-2xl" />
        <Skeleton className="mt-3 h-28 w-full !rounded-2xl" />
      </main>
    );
  }

  const { members, expenses, balances } = data;
  const meId = user.id;
  const who = (person: { id: string; name: string }) => (person.id === meId ? 'You' : person.name);
  const net = balances.totalOwedToYou - balances.totalYouOwe;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-10 pt-5">
      <h1 className="sr-only">Expenses</h1>

      {loadError && <ErrorText>{loadError.message || 'Could not refresh expenses.'}</ErrorText>}

      <section aria-labelledby="balance-heading" className="rounded-3xl bg-forest p-5 text-on-forest shadow-card">
        <h2 id="balance-heading" className="text-[0.95rem] font-semibold text-on-forest/75">
          Where you stand
        </h2>
        {balances.balances.length === 0 ? (
          <p className="mt-1 font-display text-3xl font-bold">All settled up</p>
        ) : (
          <>
            <p className="mt-1 font-display text-4xl font-extrabold leading-tight">
              {net >= 0 ? `You’re owed ${formatMoney(net)}` : `You owe ${formatMoney(-net)}`}
            </p>
            <p className="mt-1 text-[0.95rem] text-on-forest/75">
              {formatMoney(balances.totalOwedToYou)} coming to you · {formatMoney(balances.totalYouOwe)} to pay
            </p>
            <ul className="mt-4 flex flex-col gap-2.5 border-t border-white/15 pt-4">
              {balances.balances.map((b) => (
                <li key={b.counterpart.id} className="flex items-center gap-3">
                  <UserAvatar user={b.counterpart} size={36} />
                  <span className="min-w-0 flex-1 truncate">
                    {b.netAmount > 0 ? `${b.counterpart.name} owes you` : `You owe ${b.counterpart.name}`}
                  </span>
                  <span className="font-bold tabular-nums">{formatMoney(Math.abs(b.netAmount))}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <div className="mt-5">
        {adding ? (
          <Card className="pop-in p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-bold">Add an expense</h2>
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Close
              </Button>
            </div>
            <ExpenseForm members={members} meId={meId} onSubmit={handleCreate} />
          </Card>
        ) : (
          <Button size="lg" block onClick={() => setAdding(true)}>
            <IconPlus size={22} />
            Add an expense
          </Button>
        )}
      </div>

      <section className="mt-8" aria-labelledby="history-heading">
        <h2 id="history-heading" className="text-xl font-bold">
          History
          {expenses.length > 0 && <span className="ml-2 text-base font-medium text-muted">{expenses.length}</span>}
        </h2>
        <ErrorText>{actionError}</ErrorText>
        {expenses.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No expenses yet">Add the first one when someone pays for something. Everyone&apos;s share is worked out for you.</EmptyState>
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {expenses.map((expense) => (
              <li key={expense.id}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-lg font-semibold leading-snug">{expense.description}</p>
                      <p className="mt-0.5 text-[0.9rem] text-muted">
                        Paid by {who(expense.paidBy)} &middot; {dateFormat.format(new Date(expense.createdAt))}
                        {expense.category ? ` · ${expense.category}` : ''}
                      </p>
                    </div>
                    <p className="shrink-0 text-xl font-bold tabular-nums">{formatMoney(expense.amount)}</p>
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
                      <ul className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
                        {expense.splits.map((split) => {
                          const isPayersOwnShare = split.userId === expense.paidById;
                          const involvesMe = split.userId === meId || expense.paidById === meId;
                          return (
                            <li key={split.id} className="flex items-center justify-between gap-3">
                              <span className="flex min-w-0 items-center gap-2.5">
                                <UserAvatar user={split.user} size={28} />
                                <span className="truncate">{who(split.user)}</span>
                              </span>
                              <span className="flex shrink-0 items-center gap-3">
                                <span className="font-semibold tabular-nums">{formatMoney(split.amount)}</span>
                                {isPayersOwnShare ? (
                                  <Chip className="!py-0.5 !text-[0.85rem]">paid</Chip>
                                ) : split.settled ? (
                                  <Chip tone="accent" className="!py-0.5 !text-[0.85rem]">
                                    settled
                                  </Chip>
                                ) : involvesMe ? (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => handleSettle(expense.id, split.id)}
                                    disabled={settlingId !== null}
                                  >
                                    {settlingId === split.id ? 'Saving…' : 'Mark paid'}
                                  </Button>
                                ) : (
                                  <Chip tone="gold" className="!py-0.5 !text-[0.85rem]">
                                    owes
                                  </Chip>
                                )}
                              </span>
                            </li>
                          );
                        })}
                      </ul>

                      {expense.canChange ? (
                        confirmingDeleteId === expense.id ? (
                          <div className="mt-3 border-t border-line pt-3">
                            <p>Delete this expense? Everyone involved will be told, and it comes off the balances.</p>
                            <div className="mt-3 flex items-center gap-3">
                              <Button variant="danger" onClick={() => handleDelete(expense.id)} disabled={deletingId !== null}>
                                {deletingId === expense.id ? 'Deleting…' : 'Yes, delete it'}
                              </Button>
                              <Button variant="ghost" onClick={() => setConfirmingDeleteId(null)} disabled={deletingId !== null}>
                                Keep it
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-3 flex items-center gap-1 border-t border-line pt-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setActionError(null);
                                setConfirmingDeleteId(null);
                                setEditingId(expense.id);
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="!text-danger"
                              onClick={() => {
                                setActionError(null);
                                setConfirmingDeleteId(expense.id);
                              }}
                            >
                              Delete
                            </Button>
                          </div>
                        )
                      ) : (
                        (expense.createdById === meId || expense.paidById === meId) && (
                          <p className="mt-3 border-t border-line pt-3 text-[0.9rem] text-muted">
                            Part of this has been marked paid, so it can&apos;t be changed. Add a correcting expense instead.
                          </p>
                        )
                      )}
                    </>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

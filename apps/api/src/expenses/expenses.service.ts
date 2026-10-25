import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { MembershipStatus, Prisma } from '../generated/prisma/index.js';
import { CreateExpenseDto } from './dto/create-expense.dto.js';
import { changeVerdict, involvedUserIds } from './expense-rules.js';

const PUBLIC_USER_SELECT = { id: true, name: true, trustScore: true } as const;
const EXPENSE_INCLUDE = {
  paidBy: { select: PUBLIC_USER_SELECT },
  // Ids are created in order, so this keeps the people in the order they were listed — otherwise
  // the database may return them differently after an edit or a settle rewrites a row.
  splits: { include: { user: { select: PUBLIC_USER_SELECT } }, orderBy: { id: 'asc' } },
} as const;

type ExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof EXPENSE_INCLUDE }>;
type Split = { userId: string; amount: number };

const NOT_YOURS = 'Only the person who logged or paid for an expense can change it';
const ALREADY_SETTLED =
  'Part of this expense has already been marked paid, so it can no longer be changed — log a correcting expense instead';

@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private async assertCanAccess(tripId: string, userId: string): Promise<void> {
    const membership = await this.prisma.tripMembership.findUnique({
      where: { tripId_userId: { tripId, userId } },
    });
    if (!membership || membership.status !== MembershipStatus.APPROVED) {
      throw new ForbiddenException("Only approved trip members can access this trip's expenses");
    }
  }

  private async getApprovedMemberIds(tripId: string): Promise<Set<string>> {
    const rows = await this.prisma.tripMembership.findMany({
      where: { tripId, status: MembershipStatus.APPROVED },
      select: { userId: true },
    });
    return new Set(rows.map((r) => r.userId));
  }

  /** Divides `total` evenly, handing the remainder to the first few so shares always sum exactly to `total`. */
  private splitEqually(total: number, userIds: string[]): Split[] {
    const base = Math.floor(total / userIds.length);
    let remainder = total - base * userIds.length;
    return userIds.map((userId) => {
      const amount = base + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      return { userId, amount };
    });
  }

  /**
   * Validates who paid and turns the request into the shares to store — shared
   * by create and edit so both enforce the same rules. `allowedIds` is who may
   * appear; `defaultTargetIds` is who to split between when the request names
   * no one.
   */
  private resolveSplits(
    dto: CreateExpenseDto,
    paidById: string,
    allowedIds: Set<string>,
    defaultTargetIds: string[],
  ): Split[] {
    if (!allowedIds.has(paidById)) {
      throw new BadRequestException('paidById must be an approved member of this trip');
    }

    if (dto.splits?.length) {
      const sum = dto.splits.reduce((s, x) => s + x.amount, 0);
      if (sum !== dto.amount) {
        throw new BadRequestException(`splits must sum to amount (${sum} ≠ ${dto.amount})`);
      }
      if (new Set(dto.splits.map((s) => s.userId)).size !== dto.splits.length) {
        throw new BadRequestException('splits must not list the same userId twice');
      }
      for (const s of dto.splits) {
        if (!allowedIds.has(s.userId)) {
          throw new BadRequestException(`${s.userId} is not an approved member of this trip`);
        }
      }
      return dto.splits;
    }

    const targetIds = dto.splitUserIds?.length ? [...new Set(dto.splitUserIds)] : defaultTargetIds;
    for (const id of targetIds) {
      if (!allowedIds.has(id)) {
        throw new BadRequestException(`${id} is not an approved member of this trip`);
      }
    }
    return this.splitEqually(dto.amount, targetIds);
  }

  private async findInTrip(tripId: string, expenseId: string): Promise<ExpenseRow> {
    const expense = await this.prisma.expense.findUnique({ where: { id: expenseId }, include: EXPENSE_INCLUDE });
    if (!expense || expense.tripId !== tripId) throw new NotFoundException('Expense not found');
    return expense;
  }

  private assertCanChange(expense: ExpenseRow, userId: string): void {
    const verdict = changeVerdict(expense, userId);
    if (verdict === 'not-yours') throw new ForbiddenException(NOT_YOURS);
    if (verdict === 'settled') throw new ConflictException(ALREADY_SETTLED);
  }

  /**
   * Best-effort, like every notification here: a failure to tell someone must
   * never undo, or appear to fail, a change that has already been saved.
   */
  private async tell(
    tripId: string,
    actorId: string,
    recipientIds: string[],
    title: string,
    body: (recipientId: string, actorName: string) => string,
  ): Promise<void> {
    const recipients = recipientIds.filter((id) => id !== actorId);
    if (recipients.length === 0) return;
    try {
      const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });
      const actorName = actor?.name ?? 'Someone';
      await Promise.all(
        recipients.map((id) =>
          this.notifications.notifyUser(id, { title, body: body(id, actorName), url: `/trips/${tripId}/expenses` }),
        ),
      );
    } catch (error) {
      this.logger.warn(`Could not send expense notifications: ${(error as Error).message}`);
    }
  }

  async create(tripId: string, requesterId: string, dto: CreateExpenseDto) {
    await this.assertCanAccess(tripId, requesterId);
    const approvedIds = await this.getApprovedMemberIds(tripId);

    const paidById = dto.paidById ?? requesterId;
    const splits = this.resolveSplits(dto, paidById, approvedIds, [...approvedIds]);

    const expense = await this.prisma.expense.create({
      data: {
        tripId,
        paidById,
        createdById: requesterId,
        description: dto.description,
        amount: dto.amount,
        category: dto.category,
        splits: { create: splits },
      },
      include: EXPENSE_INCLUDE,
    });

    await this.tell(tripId, requesterId, involvedUserIds(expense), 'Expense added', (id, actor) => {
      const share = expense.paidById !== id ? expense.splits.find((s) => s.userId === id)?.amount : undefined;
      return `${actor} added "${expense.description}" (${expense.amount})${share ? ` — your share is ${share}` : ''}`;
    });
    return expense;
  }

  /** Each expense also says whether the viewer can still change it, so the rule lives in one place. */
  async list(tripId: string, userId: string) {
    await this.assertCanAccess(tripId, userId);
    const expenses = await this.prisma.expense.findMany({
      where: { tripId },
      include: EXPENSE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return expenses.map((expense) => ({ ...expense, canChange: changeVerdict(expense, userId) === 'ok' }));
  }

  /**
   * Replaces an expense wholesale (a PUT): the same fields as creating one.
   * Leaving out who paid keeps the current payer, and leaving out who to split
   * between keeps the current people — it never silently widens to the whole
   * trip. People who have since left the trip can stay on an expense they were
   * already part of, otherwise correcting a typo would become impossible, but
   * nobody new from outside the trip can be added.
   */
  async update(tripId: string, expenseId: string, requesterId: string, dto: CreateExpenseDto) {
    await this.assertCanAccess(tripId, requesterId);
    const existing = await this.findInTrip(tripId, expenseId);
    this.assertCanChange(existing, requesterId);

    const currentIds = involvedUserIds(existing);
    const allowedIds = new Set([...(await this.getApprovedMemberIds(tripId)), ...currentIds]);
    const paidById = dto.paidById ?? existing.paidById;
    const splits = this.resolveSplits(
      dto,
      paidById,
      allowedIds,
      existing.splits.map((s) => s.userId),
    );

    let updated: ExpenseRow;
    try {
      updated = await this.prisma.expense.update({
        // Guarded here as well as above, so a share marked paid in between still blocks the edit.
        where: { id: expenseId, splits: { none: { settled: true } } },
        data: {
          description: dto.description,
          amount: dto.amount,
          category: dto.category ?? null,
          paidById,
          splits: { deleteMany: {}, create: splits },
        },
        include: EXPENSE_INCLUDE,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException(ALREADY_SETTLED);
      }
      throw error;
    }

    await this.tell(
      tripId,
      requesterId,
      [...new Set([...currentIds, ...involvedUserIds(updated)])],
      'Expense changed',
      (id, actor) => {
        const share = updated.paidById !== id ? updated.splits.find((s) => s.userId === id)?.amount : undefined;
        const stillIn = involvedUserIds(updated).includes(id);
        const tail = share ? ` — your share is now ${share}` : stillIn ? '' : ' — you are no longer part of it';
        return `${actor} changed "${updated.description}" (${updated.amount})${tail}`;
      },
    );
    return updated;
  }

  async remove(tripId: string, expenseId: string, requesterId: string) {
    await this.assertCanAccess(tripId, requesterId);
    const existing = await this.findInTrip(tripId, expenseId);
    this.assertCanChange(existing, requesterId);

    try {
      await this.prisma.expense.delete({ where: { id: expenseId, splits: { none: { settled: true } } } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException(ALREADY_SETTLED);
      }
      throw error;
    }

    await this.tell(
      tripId,
      requesterId,
      involvedUserIds(existing),
      'Expense removed',
      (_id, actor) => `${actor} removed "${existing.description}" (${existing.amount})`,
    );
    return { id: expenseId, deleted: true };
  }

  /**
   * Pairwise net balances from the caller's perspective — positive means
   * the counterpart owes the caller, negative means the caller owes them.
   * Deliberately not a minimized global settlement graph: BLUEPRINT §06's
   * own example is pairwise ("you owe Raj X; Priya owes you Y"), and every
   * number here is directly traceable to real unsettled ExpenseSplit rows,
   * which matters more for a financial feature than a cleverer graph would.
   */
  async balances(tripId: string, userId: string) {
    await this.assertCanAccess(tripId, userId);

    const expenses = await this.prisma.expense.findMany({
      where: { tripId },
      include: { splits: true },
    });

    const net = new Map<string, number>();
    for (const expense of expenses) {
      for (const split of expense.splits) {
        if (split.settled || split.userId === expense.paidById) continue;
        if (split.userId === userId) {
          net.set(expense.paidById, (net.get(expense.paidById) ?? 0) - split.amount);
        } else if (expense.paidById === userId) {
          net.set(split.userId, (net.get(split.userId) ?? 0) + split.amount);
        }
      }
    }

    const counterpartIds = [...net.keys()].filter((id) => net.get(id) !== 0);
    const users = await this.prisma.user.findMany({
      where: { id: { in: counterpartIds } },
      select: PUBLIC_USER_SELECT,
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    const balances = counterpartIds.map((id) => ({ counterpart: userById.get(id), netAmount: net.get(id)! }));
    const totalOwedToYou = balances.filter((b) => b.netAmount > 0).reduce((s, b) => s + b.netAmount, 0);
    const totalYouOwe = balances.filter((b) => b.netAmount < 0).reduce((s, b) => s - b.netAmount, 0);

    return { balances, totalOwedToYou, totalYouOwe };
  }

  /**
   * Manual "mark as paid" (BLUEPRINT §06) — either the debtor (confirming
   * they paid back) or the creditor/payer (confirming they received it) can
   * flip this. No two-step counter-confirmation in v1 (see docs/IDEAS.md);
   * this is a ledger checkbox, not a money movement, so the risk of one
   * side marking it early is low. The other person is told.
   */
  async settleSplit(tripId: string, expenseId: string, splitId: string, userId: string) {
    await this.assertCanAccess(tripId, userId);

    const split = await this.prisma.expenseSplit.findUnique({
      where: { id: splitId },
      include: { expense: true },
    });
    if (!split || split.expenseId !== expenseId || split.expense.tripId !== tripId) {
      throw new NotFoundException('Split not found');
    }
    if (split.userId !== userId && split.expense.paidById !== userId) {
      throw new ForbiddenException('Only the two people involved in this split can settle it');
    }
    // The payer's own share is never owed to anyone, and marking it would lock the expense for nothing.
    if (split.userId === split.expense.paidById) {
      throw new BadRequestException("The person who paid doesn't owe themselves — there's nothing to settle");
    }
    if (split.settled) {
      throw new ConflictException('This split is already settled');
    }

    const settled = await this.prisma.expenseSplit.update({
      where: { id: splitId },
      data: { settled: true, settledAt: new Date() },
    });

    const otherPerson = userId === split.userId ? split.expense.paidById : split.userId;
    await this.tell(tripId, userId, [otherPerson], 'Share marked as paid', (_id, actor) =>
      userId === split.userId
        ? `${actor} marked their share (${split.amount}) of "${split.expense.description}" as paid`
        : `${actor} marked your share (${split.amount}) of "${split.expense.description}" as paid`,
    );
    return settled;
  }
}

import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MembershipStatus } from '../generated/prisma/index.js';
import { CreateExpenseDto } from './dto/create-expense.dto.js';

const PUBLIC_USER_SELECT = { id: true, name: true, trustScore: true } as const;

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

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
  private splitEqually(total: number, userIds: string[]): { userId: string; amount: number }[] {
    const base = Math.floor(total / userIds.length);
    let remainder = total - base * userIds.length;
    return userIds.map((userId) => {
      const amount = base + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      return { userId, amount };
    });
  }

  async create(tripId: string, requesterId: string, dto: CreateExpenseDto) {
    await this.assertCanAccess(tripId, requesterId);
    const approvedIds = await this.getApprovedMemberIds(tripId);

    const paidById = dto.paidById ?? requesterId;
    if (!approvedIds.has(paidById)) {
      throw new BadRequestException('paidById must be an approved member of this trip');
    }

    let splits: { userId: string; amount: number }[];
    if (dto.splits?.length) {
      const sum = dto.splits.reduce((s, x) => s + x.amount, 0);
      if (sum !== dto.amount) {
        throw new BadRequestException(`splits must sum to amount (${sum} ≠ ${dto.amount})`);
      }
      if (new Set(dto.splits.map((s) => s.userId)).size !== dto.splits.length) {
        throw new BadRequestException('splits must not list the same userId twice');
      }
      for (const s of dto.splits) {
        if (!approvedIds.has(s.userId)) {
          throw new BadRequestException(`${s.userId} is not an approved member of this trip`);
        }
      }
      splits = dto.splits;
    } else {
      const targetIds = dto.splitUserIds?.length ? [...new Set(dto.splitUserIds)] : [...approvedIds];
      for (const id of targetIds) {
        if (!approvedIds.has(id)) {
          throw new BadRequestException(`${id} is not an approved member of this trip`);
        }
      }
      splits = this.splitEqually(dto.amount, targetIds);
    }

    return this.prisma.expense.create({
      data: {
        tripId,
        paidById,
        description: dto.description,
        amount: dto.amount,
        category: dto.category,
        splits: { create: splits },
      },
      include: {
        paidBy: { select: PUBLIC_USER_SELECT },
        splits: { include: { user: { select: PUBLIC_USER_SELECT } } },
      },
    });
  }

  async list(tripId: string, userId: string) {
    await this.assertCanAccess(tripId, userId);
    return this.prisma.expense.findMany({
      where: { tripId },
      include: {
        paidBy: { select: PUBLIC_USER_SELECT },
        splits: { include: { user: { select: PUBLIC_USER_SELECT } } },
      },
      orderBy: { createdAt: 'desc' },
    });
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
   * side marking it early is low.
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
    if (split.settled) {
      throw new ConflictException('This split is already settled');
    }

    return this.prisma.expenseSplit.update({
      where: { id: splitId },
      data: { settled: true, settledAt: new Date() },
    });
  }
}

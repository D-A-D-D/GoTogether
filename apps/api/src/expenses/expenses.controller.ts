import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator.js';
import { ExpensesService } from './expenses.service.js';
import { CreateExpenseDto } from './dto/create-expense.dto.js';

@Controller('trips/:tripId')
@UseGuards(JwtAccessGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post('expenses')
  create(@CurrentUser() user: RequestUser, @Param('tripId') tripId: string, @Body() dto: CreateExpenseDto) {
    return this.expensesService.create(tripId, user.userId, dto);
  }

  @Get('expenses')
  list(@CurrentUser() user: RequestUser, @Param('tripId') tripId: string) {
    return this.expensesService.list(tripId, user.userId);
  }

  @Get('balances')
  balances(@CurrentUser() user: RequestUser, @Param('tripId') tripId: string) {
    return this.expensesService.balances(tripId, user.userId);
  }

  @Patch('expenses/:expenseId/splits/:splitId/settle')
  settleSplit(
    @CurrentUser() user: RequestUser,
    @Param('tripId') tripId: string,
    @Param('expenseId') expenseId: string,
    @Param('splitId') splitId: string,
  ) {
    return this.expensesService.settleSplit(tripId, expenseId, splitId, user.userId);
  }
}

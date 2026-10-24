import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator.js';
import { BlocksService } from './blocks.service.js';
import { ReportsService } from './reports.service.js';
import { CreateReportDto } from './dto/create-report.dto.js';

@Controller()
@UseGuards(JwtAccessGuard)
export class SafetyController {
  constructor(
    private readonly blocks: BlocksService,
    private readonly reports: ReportsService,
  ) {}

  // Declared before the `:userId` routes so "me" is never read as a user id.
  @Get('users/me/blocks')
  listMyBlocks(@CurrentUser() user: RequestUser) {
    return this.blocks.listMine(user.userId);
  }

  @Post('users/:userId/block')
  @HttpCode(204)
  async block(@CurrentUser() user: RequestUser, @Param('userId') userId: string): Promise<void> {
    await this.blocks.block(user.userId, userId);
  }

  @Delete('users/:userId/block')
  @HttpCode(204)
  async unblock(@CurrentUser() user: RequestUser, @Param('userId') userId: string): Promise<void> {
    await this.blocks.unblock(user.userId, userId);
  }

  @Post('reports')
  createReport(@CurrentUser() user: RequestUser, @Body() dto: CreateReportDto) {
    return this.reports.create(user.userId, dto);
  }
}

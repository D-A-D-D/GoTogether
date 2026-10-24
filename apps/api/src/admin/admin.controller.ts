import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator.js';
import { AdminGuard } from './admin.guard.js';
import { ModerationService } from './moderation.service.js';
import { ListReportsDto, ReviewReportDto, SetAccountStatusDto } from './dto/admin.dto.js';

// Everything under /admin needs a signed-in admin. The guards are listed in
// order: JwtAccessGuard authenticates (and loads the role), AdminGuard checks it.
@Controller('admin')
@UseGuards(JwtAccessGuard, AdminGuard)
export class AdminController {
  constructor(private readonly moderation: ModerationService) {}

  @Get('reports')
  listReports(@Query() query: ListReportsDto) {
    return this.moderation.listReports(query.status);
  }

  @Patch('reports/:reportId')
  reviewReport(
    @CurrentUser() actor: RequestUser,
    @Param('reportId') reportId: string,
    @Body() dto: ReviewReportDto,
  ) {
    return this.moderation.reviewReport(actor, reportId, dto);
  }

  @Get('users/restricted')
  listRestricted() {
    return this.moderation.listRestricted();
  }

  @Post('users/:userId/status')
  setAccountStatus(
    @CurrentUser() actor: RequestUser,
    @Param('userId') userId: string,
    @Body() dto: SetAccountStatusDto,
  ) {
    return this.moderation.setAccountStatus(actor, userId, dto);
  }
}

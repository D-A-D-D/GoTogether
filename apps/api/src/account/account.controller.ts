import { Body, Controller, Delete, Get, Header, Patch, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LIMITS } from '../common/throttle-limits.js';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator.js';
import { AccountService } from './account.service.js';
import { DeleteAccountDto } from './dto/delete-account.dto.js';
import { UpdateSettingsDto } from './dto/update-settings.dto.js';

@Controller('users/me')
@UseGuards(JwtAccessGuard)
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  /** The person's own data as a JSON download. */
  @Get('export')
  @Throttle({ default: LIMITS.accountAction })
  @Header('Content-Disposition', 'attachment; filename="gotogether-my-data.json"')
  export(@CurrentUser() user: RequestUser) {
    return this.accountService.exportData(user.userId);
  }

  /** Privacy choices that other people can feel (currently read receipts). */
  @Patch('settings')
  updateSettings(@CurrentUser() user: RequestUser, @Body() dto: UpdateSettingsDto) {
    return this.accountService.updateSettings(user.userId, dto);
  }

  /** Irreversible, so it asks for the password again (see AccountService.deleteAccount). */
  @Delete()
  @Throttle({ default: LIMITS.accountAction })
  deleteAccount(@CurrentUser() user: RequestUser, @Body() dto: DeleteAccountDto) {
    return this.accountService.deleteAccount(user.userId, dto);
  }
}

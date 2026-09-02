import { Body, Controller, Get, NotFoundException, Patch, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator.js';
import { UsersService } from './users.service.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';

@Controller('users')
@UseGuards(JwtAccessGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async me(@CurrentUser() currentUser: RequestUser) {
    const user = await this.usersService.findByIdWithTags(currentUser.userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.usersService.toPublicProfile(user);
  }

  @Patch('me')
  async updateMe(@CurrentUser() currentUser: RequestUser, @Body() dto: UpdateProfileDto) {
    const user = await this.usersService.updateProfile(currentUser.userId, dto);
    return this.usersService.toPublicProfile(user);
  }
}

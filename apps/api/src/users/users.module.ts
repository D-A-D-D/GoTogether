import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';

// PassportModule is imported here (not just in AuthModule) because
// UsersController's JwtAccessGuard (AuthGuard('jwt-access')) needs
// PassportModule's AuthModuleOptions provider in its own module scope.
@Module({
  imports: [PassportModule.register({})],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}

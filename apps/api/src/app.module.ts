import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { HttpThrottlerGuard } from './common/http-throttler.guard.js';
import { LIMITS, TOO_MANY_REQUESTS } from './common/throttle-limits.js';
import { validateEnv } from './config/env.js';
import { AppController } from './app.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { TagsModule } from './tags/tags.module.js';
import { TripsModule } from './trips/trips.module.js';
import { ChatModule } from './chat/chat.module.js';
import { ExpensesModule } from './expenses/expenses.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { SafetyModule } from './safety/safety.module.js';
import { AccountModule } from './account/account.module.js';
import { AdminModule } from './admin/admin.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ...LIMITS.default }], errorMessage: TOO_MANY_REQUESTS }),
    PrismaModule,
    AuthModule,
    UsersModule,
    TagsModule,
    TripsModule,
    ChatModule,
    ExpensesModule,
    ReviewsModule,
    NotificationsModule,
    SafetyModule,
    AccountModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: HttpThrottlerGuard }],
})
export class AppModule {}

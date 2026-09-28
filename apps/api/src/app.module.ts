import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    TagsModule,
    TripsModule,
    ChatModule,
    ExpensesModule,
    ReviewsModule,
    NotificationsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}

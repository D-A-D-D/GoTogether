import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { TagsModule } from './tags/tags.module.js';
import { TripsModule } from './trips/trips.module.js';
import { ChatModule } from './chat/chat.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    TagsModule,
    TripsModule,
    ChatModule,
  ],
  controllers: [AppController],
})
export class AppModule {}

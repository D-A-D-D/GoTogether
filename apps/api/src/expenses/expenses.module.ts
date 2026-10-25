import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ExpensesService } from './expenses.service.js';
import { ExpensesController } from './expenses.controller.js';

@Module({
  imports: [PassportModule.register({}), NotificationsModule],
  providers: [ExpensesService],
  controllers: [ExpensesController],
  exports: [ExpensesService],
})
export class ExpensesModule {}

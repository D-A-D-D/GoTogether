import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ExpensesService } from './expenses.service.js';
import { ExpensesController } from './expenses.controller.js';

@Module({
  imports: [PassportModule.register({})],
  providers: [ExpensesService],
  controllers: [ExpensesController],
  exports: [ExpensesService],
})
export class ExpensesModule {}

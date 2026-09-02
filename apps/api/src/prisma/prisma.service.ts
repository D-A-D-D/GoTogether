import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/index.js';

// No eager $connect() in onModuleInit — Prisma connects lazily on first
// query. That keeps the app (and routes that don't touch the database,
// like /health) bootable without a live Postgres instance available.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

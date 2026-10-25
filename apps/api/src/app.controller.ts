import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from './prisma/prisma.service.js';

// Both are polled by uptime monitors and the hosting platform, so neither is rate limited.
@Controller()
@SkipThrottle()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: the process is up. Touches nothing else, so a database outage can't get it restarted. */
  @Get('health')
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /** Readiness: it can reach the database. A 503 tells a load balancer not to send traffic here. */
  @Get('health/ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TagCategory } from '../generated/prisma/index.js';

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.tag.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * Tags eligible to be used as a Trip's private exclude filter.
   * Only STYLE tags qualify — identity/dietary/safety tags describe who
   * someone is, not how a trip runs, and must stay include-only
   * (docs/BLUEPRINT.md §01).
   */
  findExcludeEligible() {
    return this.prisma.tag.findMany({
      where: { isActive: true, category: TagCategory.STYLE },
      orderBy: { name: 'asc' },
    });
  }
}

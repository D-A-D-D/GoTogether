// Seeds the controlled tag vocabulary (docs/BLUEPRINT.md §01, §03).
// Run with: npx tsx prisma/seed.ts
import { PrismaClient, TagCategory } from '../src/generated/prisma/index.js';

const prisma = new PrismaClient();

const tags: { name: string; category: TagCategory }[] = [
  // STYLE — how a trip runs. Safe as a private exclude filter.
  { name: 'adventurous', category: TagCategory.STYLE },
  { name: 'trekking', category: TagCategory.STYLE },
  { name: 'party', category: TagCategory.STYLE },
  { name: 'quiet', category: TagCategory.STYLE },
  { name: 'budget', category: TagCategory.STYLE },
  { name: 'luxury', category: TagCategory.STYLE },
  { name: 'backpacking', category: TagCategory.STYLE },
  { name: 'wellness', category: TagCategory.STYLE },
  { name: 'photography', category: TagCategory.STYLE },
  { name: 'early-riser', category: TagCategory.STYLE },
  { name: 'night-owl', category: TagCategory.STYLE },
  { name: 'non-smoking', category: TagCategory.STYLE },
  { name: 'pet-friendly', category: TagCategory.STYLE },

  // IDENTITY — who someone is. Include-only; never a silent exclude filter.
  { name: 'religious', category: TagCategory.IDENTITY },
  { name: 'lgbtq-friendly', category: TagCategory.IDENTITY },
  { name: 'women-only', category: TagCategory.IDENTITY },
  { name: 'family-friendly', category: TagCategory.IDENTITY },
  { name: 'solo-traveler', category: TagCategory.IDENTITY },

  // DIETARY
  { name: 'vegetarian', category: TagCategory.DIETARY },
  { name: 'vegan', category: TagCategory.DIETARY },
  { name: 'halal', category: TagCategory.DIETARY },
  { name: 'gluten-free', category: TagCategory.DIETARY },

  // SAFETY
  { name: 'verified-only', category: TagCategory.SAFETY },
  { name: 'women-travelers-priority', category: TagCategory.SAFETY },
];

async function main() {
  for (const tag of tags) {
    await prisma.tag.upsert({
      where: { name: tag.name },
      update: { category: tag.category },
      create: tag,
    });
  }
  console.log(`Seeded ${tags.length} tags.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

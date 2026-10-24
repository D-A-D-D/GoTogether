// Grants or removes admin access for an account. The ONLY way to change a role:
// admins can suspend and close accounts, so becoming one must not be reachable
// from any request — it needs database access, i.e. someone who runs this.
//
// Usage (from apps/api):
//   npx tsx scripts/set-role.ts <email> ADMIN
//   npx tsx scripts/set-role.ts <email> USER
//
// A running API caches roles for up to 30 seconds, so a change takes effect
// within that long (docs/ROADMAP.md, "Moderation foundation").
import { PrismaClient, UserRole } from '../src/generated/prisma/index.js';

const [email, requested] = process.argv.slice(2);
const role = (requested ?? '').toUpperCase();

if (!email || (role !== UserRole.ADMIN && role !== UserRole.USER)) {
  console.error('Usage: npx tsx scripts/set-role.ts <email> <ADMIN|USER>');
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, role: true } });
  if (!user) {
    console.error(`No account with the email ${email}.`);
    process.exit(1);
  }
  if (user.role === role) {
    console.log(`${user.name} <${email}> is already ${role}. Nothing to do.`);
  } else {
    await prisma.user.update({ where: { id: user.id }, data: { role: role as UserRole } });
    console.log(`${user.name} <${email}>: ${user.role} -> ${role}`);
  }
} finally {
  await prisma.$disconnect();
}

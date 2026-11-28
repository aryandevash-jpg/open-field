// Grants or revokes platform-admin rights. Deliberately a CLI script, not an
// API endpoint: only someone with database credentials can create an admin.
//
//   npm run admin:grant -- someone@example.com
//   npm run admin:grant -- someone@example.com --revoke

import { prisma } from "../src/lib/prisma.js";

const [email, flag] = process.argv.slice(2);

if (!email || (flag !== undefined && flag !== "--revoke")) {
  console.error("Usage: npm run admin:grant -- <email> [--revoke]");
  process.exit(1);
}

const isPlatformAdmin = flag !== "--revoke";

try {
  const { count } = await prisma.user.updateMany({
    where: { email: email.trim().toLowerCase() },
    data: { isPlatformAdmin },
  });
  if (count === 0) {
    console.error(`No user found with email ${email}`);
    process.exitCode = 1;
  } else {
    console.log(`${isPlatformAdmin ? "Granted" : "Revoked"} platform admin for ${email}`);
  }
} finally {
  await prisma.$disconnect();
}

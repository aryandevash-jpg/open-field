import { prisma } from "./lib/prisma.js";

async function main() {
  console.log("Testing database...");
console.log("Starting user INSERT...");
  const user = await prisma.user.create({
    data: {
      name: "OpenField Test",
      email: `test-${Date.now()}@openfield.dev`,
      passwordHash: "temporary-test-hash",
    },
  });
console.log("User INSERT completed!");
  console.log("User created:", user.id);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
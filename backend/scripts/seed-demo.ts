// Idempotent demo data for trying the web app locally. Safe to re-run.
//
//   npm run seed:demo
//
// Accounts (password for all: openfield-demo):
//   demo-verifier@openfield.test     platform admin (review queue, categories)
//   demo-reporter@openfield.test     community member who reports issues
//   demo-coordinator@openfield.test  owner of "Demo Green Pune" (handles Environment)
//   demo-partner@openfield.test      owner of "Demo Lake Trust" (handles Waste)
//
// Both organizations serve central Pune, so a verified "Waste" report near
// Shivajinagar is offered to both (Green Pune via the parent category).

import bcrypt from "bcryptjs";
import { OrganizationRole } from "../src/generated/prisma/client.js";
import { prisma } from "../src/lib/prisma.js";
import { createServiceArea } from "../src/modules/organizations/organization.service.js";

const PASSWORD = "openfield-demo";
const PUNE_SQUARE = [[73.8, 18.48], [73.92, 18.48], [73.92, 18.58], [73.8, 18.58], [73.8, 18.48]] as [number, number][];

const user = async (label: string, name: string, isPlatformAdmin = false) => {
  const email = `demo-${label}@openfield.test`;
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  return prisma.user.upsert({
    where: { email },
    create: { email, name, passwordHash, isPlatformAdmin },
    update: { isPlatformAdmin },
  });
};

const category = (slug: string, name: string, parentId: string | null = null) =>
  prisma.category.upsert({ where: { slug }, create: { slug, name, parentId }, update: {} });

const organization = async (name: string, ownerId: string, categoryId: string, teamName: string) => {
  const existing = await prisma.organization.findFirst({ where: { name } });
  const org = existing ?? (await prisma.organization.create({ data: { name, description: "Demo organization" } }));
  await prisma.organizationMembership.upsert({
    where: { userId_organizationId: { userId: ownerId, organizationId: org.id } },
    create: { userId: ownerId, organizationId: org.id, role: OrganizationRole.OWNER },
    update: {},
  });
  const team =
    (await prisma.team.findFirst({ where: { organizationId: org.id, name: teamName } })) ??
    (await prisma.team.create({ data: { organizationId: org.id, name: teamName, createdByUserId: ownerId } }));
  const membership = await prisma.organizationMembership.findUniqueOrThrow({
    where: { userId_organizationId: { userId: ownerId, organizationId: org.id } },
  });
  await prisma.teamMembership.upsert({
    where: { teamId_membershipId: { teamId: team.id, membershipId: membership.id } },
    create: { teamId: team.id, organizationId: org.id, membershipId: membership.id, isLeader: true },
    update: {},
  });
  await prisma.organizationCategory.upsert({
    where: { organizationId_categoryId: { organizationId: org.id, categoryId } },
    create: { organizationId: org.id, categoryId },
    update: { isActive: true },
  });
  if ((await prisma.organizationServiceArea.count({ where: { organizationId: org.id, isActive: true } })) === 0) {
    await createServiceArea(org.id, { name: "Central Pune", area: { type: "Polygon", coordinates: [PUNE_SQUARE] } });
  }
  return org;
};

try {
  await user("verifier", "Vera Verifier", true);
  await user("reporter", "Ravi Reporter");
  const coordinator = await user("coordinator", "Chitra Coordinator");
  const partner = await user("partner", "Pavan Partner");

  const environment = await category("environment", "Environment");
  const waste = await category("waste", "Waste", environment.id);
  await category("roads", "Roads");

  await organization("Demo Green Pune", coordinator.id, environment.id, "Green Squad");
  await organization("Demo Lake Trust", partner.id, waste.id, "Lake Team");

  console.log("Demo data ready. Sign in with any demo-*@openfield.test account (see scripts/seed-demo.ts).");
} finally {
  await prisma.$disconnect();
}

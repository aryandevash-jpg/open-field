// Deletes everything a test run created, children before parents (every FK
// is ON DELETE RESTRICT). `tag` is the RUN prefix used for names, slugs and emails.

import { prisma } from "../../src/lib/prisma.js";

export const cleanupRun = async (tag: string) => {
  const users = { email: { startsWith: tag } };
  const organizations = { name: { startsWith: tag } };
  const reports = { submittedBy: users };

  await prisma.notification.deleteMany({ where: { user: users } });
  await prisma.reportComment.deleteMany({ where: { report: reports } });
  await prisma.assignmentCollaborationTeam.deleteMany({ where: { collaboration: { assignment: { report: reports } } } });
  await prisma.assignmentCollaboration.deleteMany({ where: { assignment: { report: reports } } });
  // Transfers point at the assignment they replace: delete from the newest end
  // of each chain until nothing is left.
  while ((await prisma.assignment.deleteMany({ where: { report: reports, supersededBy: { is: null } } })).count > 0);
  await prisma.reportOpportunity.deleteMany({ where: { report: reports } });
  await prisma.reportHistory.deleteMany({ where: { report: reports } });
  await prisma.reportMedia.deleteMany({ where: { report: reports } });
  // Duplicates point at their canonical report, so delete them first.
  await prisma.report.deleteMany({ where: { ...reports, duplicateOfReportId: { not: null } } });
  await prisma.report.deleteMany({ where: reports });
  await prisma.eventParticipation.deleteMany({ where: { event: { hostOrganization: organizations } } });
  await prisma.event.deleteMany({ where: { hostOrganization: organizations } });
  await prisma.organizationServiceArea.deleteMany({ where: { organization: organizations } });
  await prisma.organizationCategory.deleteMany({ where: { organization: organizations } });
  await prisma.teamMembership.deleteMany({ where: { team: { organization: organizations } } });
  await prisma.team.deleteMany({ where: { organization: organizations } });
  await prisma.organizationMembership.deleteMany({ where: { organization: organizations } });
  await prisma.organization.deleteMany({ where: organizations });
  await prisma.category.updateMany({ where: { slug: { startsWith: tag } }, data: { parentId: null } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: tag } } });
  await prisma.user.deleteMany({ where: users });
};

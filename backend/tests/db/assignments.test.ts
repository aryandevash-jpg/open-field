// HTTP + database tests for distribution (opportunities), claiming,
// assignment lifecycle, lazy expiry and report resolution.
//
//   npm run test:db

import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { OrganizationRole } from "../../src/generated/prisma/client.js";
import { prisma } from "../../src/lib/prisma.js";
import { createOrganization } from "../../src/modules/organizations/organization.service.js";
import { cleanupRun } from "../helpers/cleanup.js";
import { assertError, createUser, dataOf, request, startServer, type TestUser } from "../helpers/http.js";

const RUN = `test-assign-${Date.now()}`;
const PUNE_SQUARE = [[73.8, 18.48], [73.92, 18.48], [73.92, 18.58], [73.8, 18.58], [73.8, 18.48]];
const SHIVAJINAGAR = { lat: 18.5204, lng: 73.8567 };
const MUMBAI = { lat: 19.076, lng: 72.8777 };

type Assignment = { id: string; status: string; teamId: string; startDeadlineAt: string; endedAt: string | null };
type Report = { id: string; status: string };

let server: Awaited<ReturnType<typeof startServer>>;
let reporter: TestUser;
let verifier: TestUser;
// Org A: capability on the PARENT category (covers the child by inheritance).
let ownerA: TestUser;
let coordinatorA: TestUser;
let teamMemberA: TestUser;
let plainMemberA: TestUser;
// Org B: capability on the child category.
let ownerB: TestUser;
// Org C: same area, unrelated category; never matches.
let ownerC: TestUser;
const org = { A: "", B: "", C: "" };
const team = { A: "", B: "", inactiveA: "" };
let childCategoryId = "";

const api = (method: "GET" | "POST", path: string, token: string, body?: unknown) =>
  request(server.baseUrl, method, `/api/v1${path}`, { token, body });

const addMember = async (organizationId: string, user: TestUser, role: OrganizationRole) =>
  prisma.organizationMembership.create({ data: { organizationId, userId: user.id, role } });

const addServiceArea = (organizationId: string, token: string) =>
  api("POST", `/organizations/${organizationId}/service-areas`, token, {
    name: "Central Pune",
    area: { type: "Polygon", coordinates: [PUNE_SQUARE] },
  }).then(dataOf);

const submit = async (location = SHIVAJINAGAR, extra: Record<string, unknown> = {}) =>
  dataOf<Report>(
    await api("POST", "/reports", reporter.token, {
      title: "Overflowing bin",
      description: "Garbage on the footpath",
      categoryId: childCategoryId,
      location,
      ...extra,
    })
  );

const verify = async (reportId: string) => {
  dataOf(await api("POST", `/reports/${reportId}/start-review`, verifier.token));
  return dataOf<Report>(await api("POST", `/reports/${reportId}/verify`, verifier.token));
};

const verifiedReport = async () => {
  const report = await submit();
  await verify(report.id);
  return report.id;
};

const claim = (reportId: string, teamId: string, token: string) =>
  api("POST", `/reports/${reportId}/assignments/claim`, token, { teamId });

const reportStatus = async (reportId: string) =>
  (await prisma.report.findUniqueOrThrow({ where: { id: reportId }, select: { status: true } })).status;

const opportunityIds = async (organizationId: string, token: string) =>
  dataOf<Report[]>(await api("GET", `/reports/opportunities?organizationId=${organizationId}`, token)).map((r) => r.id);

before(async () => {
  server = await startServer();
  [reporter, ownerA, coordinatorA, teamMemberA, plainMemberA, ownerB, ownerC] = await Promise.all(
    ["reporter", "owner-a", "coord-a", "team-member-a", "plain-a", "owner-b", "owner-c"].map((label) => createUser(RUN, label))
  );
  verifier = await createUser(RUN, "verifier", { isPlatformAdmin: true });

  const parent = await prisma.category.create({ data: { name: "Environment", slug: `${RUN}-env` } });
  const child = await prisma.category.create({ data: { name: "Waste", slug: `${RUN}-waste`, parentId: parent.id } });
  const unrelated = await prisma.category.create({ data: { name: "Roads", slug: `${RUN}-roads` } });
  childCategoryId = child.id;

  org.A = (await createOrganization(ownerA.id, { name: `${RUN}-A` })).id;
  org.B = (await createOrganization(ownerB.id, { name: `${RUN}-B` })).id;
  org.C = (await createOrganization(ownerC.id, { name: `${RUN}-C` })).id;

  await addMember(org.A, coordinatorA, OrganizationRole.COORDINATOR);
  const teamMembership = await addMember(org.A, teamMemberA, OrganizationRole.MEMBER);
  await addMember(org.A, plainMemberA, OrganizationRole.MEMBER);

  team.A = (await prisma.team.create({ data: { organizationId: org.A, name: "A Squad", createdByUserId: ownerA.id } })).id;
  team.inactiveA = (
    await prisma.team.create({ data: { organizationId: org.A, name: "A Retired", createdByUserId: ownerA.id, isActive: false } })
  ).id;
  team.B = (await prisma.team.create({ data: { organizationId: org.B, name: "B Squad", createdByUserId: ownerB.id } })).id;
  await prisma.teamMembership.create({ data: { teamId: team.A, organizationId: org.A, membershipId: teamMembership.id } });

  await prisma.organizationCategory.createMany({
    data: [
      { organizationId: org.A, categoryId: parent.id },
      { organizationId: org.B, categoryId: child.id },
      { organizationId: org.C, categoryId: unrelated.id },
    ],
  });
  await addServiceArea(org.A, ownerA.token);
  await addServiceArea(org.B, ownerB.token);
  await addServiceArea(org.C, ownerC.token);
});

after(async () => {
  await server.close();
  await cleanupRun(RUN);
  await prisma.$disconnect();
});

describe("distribution", () => {
  test("verifying an independent report offers it to every matching organization", async () => {
    const reportId = await verifiedReport();

    const offered = await prisma.reportOpportunity.findMany({ where: { reportId } });
    assert.deepEqual(offered.map((o) => o.organizationId).sort(), [org.A, org.B].sort());

    assert.ok((await opportunityIds(org.A, plainMemberA.token)).includes(reportId));
    assert.ok(!(await opportunityIds(org.C, ownerC.token)).includes(reportId));
    assertError(await api("GET", `/reports/opportunities?organizationId=${org.A}`, ownerC.token), 403, "FORBIDDEN");

    // Offered organizations can now see the report; others still cannot.
    dataOf(await api("GET", `/reports/${reportId}`, plainMemberA.token));
    assertError(await api("GET", `/reports/${reportId}`, ownerC.token), 404, "REPORT_NOT_FOUND");
  });

  test("a report outside every service area is offered to nobody", async () => {
    const report = await submit(MUMBAI);
    await verify(report.id);
    assert.equal(await prisma.reportOpportunity.count({ where: { reportId: report.id } }), 0);
  });
});

describe("claim → start → complete → resolve", () => {
  test("the full happy path, including reopen and a second round", async () => {
    const reportId = await verifiedReport();

    const assignment = dataOf<Assignment>(await claim(reportId, team.A, coordinatorA.token));
    assert.equal(assignment.status, "CLAIMED");
    const hoursToDeadline = (Date.parse(assignment.startDeadlineAt) - Date.now()) / 3_600_000;
    assert.ok(hoursToDeadline > 23.9 && hoursToDeadline <= 24, "start deadline is 24h after the claim");

    assertError(await claim(reportId, team.B, ownerB.token), 409, "REPORT_ALREADY_CLAIMED");
    assert.ok(!(await opportunityIds(org.B, ownerB.token)).includes(reportId), "claimed reports leave the list");

    assert.equal(dataOf<Assignment>(await api("POST", `/assignments/${assignment.id}/start`, teamMemberA.token)).status, "IN_PROGRESS");
    const completed = dataOf<Assignment>(
      await api("POST", `/assignments/${assignment.id}/complete`, teamMemberA.token, {
        note: "Bin emptied and area swept",
        media: [{ url: "https://cdn.example.org/after.jpg" }],
      })
    );
    assert.equal(completed.status, "COMPLETED");
    assert.ok(completed.endedAt);
    assert.equal(await reportStatus(reportId), "RESOLUTION_PENDING");
    assert.equal(await prisma.reportMedia.count({ where: { reportId } }), 1);

    assert.equal(dataOf<Report>(await api("POST", `/reports/${reportId}/resolve`, verifier.token)).status, "RESOLVED");
    assertError(await api("POST", `/reports/${reportId}/reopen`, verifier.token), 422, "VALIDATION_FAILED");
    assert.equal(
      dataOf<Report>(await api("POST", `/reports/${reportId}/reopen`, verifier.token, { reason: "Overflowing again" })).status,
      "REOPENED"
    );
    assert.equal(dataOf<Report>(await api("POST", `/reports/${reportId}/verify`, verifier.token)).status, "VERIFIED");

    // Second round: B takes it this time.
    dataOf(await claim(reportId, team.B, ownerB.token));
    const assignments = dataOf<Assignment[]>(await api("GET", `/reports/${reportId}/assignments`, ownerA.token));
    assert.deepEqual(assignments.map((a) => a.status), ["COMPLETED", "CLAIMED"]);

    const actions = (await prisma.reportHistory.findMany({ where: { reportId }, orderBy: { createdAt: "asc" } })).map(
      (entry) => entry.action
    );
    assert.deepEqual(actions, ["SUBMITTED", "START_REVIEW", "VERIFY", "ASSIGNMENT_COMPLETED", "RESOLVE", "REOPEN", "VERIFY"]);
  });

  test("return-to-verified sends the report back for another team", async () => {
    const reportId = await verifiedReport();
    const assignment = dataOf<Assignment>(await claim(reportId, team.A, ownerA.token));
    dataOf(await api("POST", `/assignments/${assignment.id}/start`, ownerA.token));
    dataOf(await api("POST", `/assignments/${assignment.id}/complete`, ownerA.token));

    assertError(await api("POST", `/reports/${reportId}/return-to-verified`, verifier.token, {}), 422, "VALIDATION_FAILED");
    const back = dataOf<Report>(
      await api("POST", `/reports/${reportId}/return-to-verified`, verifier.token, { reason: "Photo shows it is not done" })
    );
    assert.equal(back.status, "VERIFIED");
    assert.equal(dataOf<Assignment>(await claim(reportId, team.B, ownerB.token)).status, "CLAIMED");
  });
});

describe("claim rules", () => {
  test("who and what can be claimed", async () => {
    const reportId = await verifiedReport();

    assertError(await claim(reportId, team.A, plainMemberA.token), 403, "FORBIDDEN"); // not a coordinator
    assertError(await claim(reportId, team.B, coordinatorA.token), 403, "FORBIDDEN"); // another org's team
    assertError(await claim(reportId, team.inactiveA, ownerA.token), 422, "TEAM_NOT_AVAILABLE");

    const unrelatedTeam = await prisma.team.create({ data: { organizationId: org.C, name: "C Squad", createdByUserId: ownerC.id } });
    assertError(await claim(reportId, unrelatedTeam.id, ownerC.token), 404, "REPORT_NOT_FOUND"); // never offered

    const unverified = await submit();
    assertError(await claim(unverified.id, team.A, ownerA.token), 404, "REPORT_NOT_FOUND"); // no opportunity yet
  });

  test("two organizations claiming at once: exactly one wins", async () => {
    const reportId = await verifiedReport();
    const results = await Promise.all([claim(reportId, team.A, ownerA.token), claim(reportId, team.B, ownerB.token)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal(await prisma.assignment.count({ where: { reportId, endedAt: null } }), 1);
  });

  test("the database allows only one active assignment per report", async () => {
    const reportId = await verifiedReport();
    const first = dataOf<Assignment>(await claim(reportId, team.A, ownerA.token));
    await assert.rejects(
      prisma.assignment.create({
        data: { reportId, organizationId: org.B, teamId: team.B, claimedByUserId: ownerB.id, startDeadlineAt: new Date() },
      })
    );
    // Active statuses must have no end time, ended ones must.
    await assert.rejects(prisma.assignment.update({ where: { id: first.id }, data: { status: "COMPLETED" } }));
  });
});

describe("assignment lifecycle rules", () => {
  test("only coordinators and the assigned team can work on it", async () => {
    const reportId = await verifiedReport();
    const assignment = dataOf<Assignment>(await claim(reportId, team.A, coordinatorA.token));

    assertError(await api("POST", `/assignments/${assignment.id}/start`, plainMemberA.token), 403, "FORBIDDEN");
    assertError(await api("POST", `/assignments/${assignment.id}/start`, ownerB.token), 404, "ASSIGNMENT_NOT_FOUND");
    assertError(await api("POST", `/assignments/${assignment.id}/complete`, teamMemberA.token), 409, "ASSIGNMENT_INVALID_TRANSITION"); // not started
  });

  test("a claim not started before its deadline expires and frees the report", async () => {
    const reportId = await verifiedReport();
    const assignment = dataOf<Assignment>(await claim(reportId, team.A, ownerA.token));
    await prisma.assignment.update({ where: { id: assignment.id }, data: { startDeadlineAt: new Date(Date.now() - 1000) } });

    assert.ok((await opportunityIds(org.B, ownerB.token)).includes(reportId), "overdue claims count as free");
    assertError(await api("POST", `/assignments/${assignment.id}/start`, teamMemberA.token), 409, "ASSIGNMENT_EXPIRED");
    assert.equal((await prisma.assignment.findUniqueOrThrow({ where: { id: assignment.id } })).status, "EXPIRED");

    assert.equal(dataOf<Assignment>(await claim(reportId, team.B, ownerB.token)).status, "CLAIMED");
  });

  test("an overdue claim is expired when someone else claims", async () => {
    const reportId = await verifiedReport();
    const assignment = dataOf<Assignment>(await claim(reportId, team.A, ownerA.token));
    await prisma.assignment.update({ where: { id: assignment.id }, data: { startDeadlineAt: new Date(Date.now() - 1000) } });

    dataOf(await claim(reportId, team.B, ownerB.token));
    assert.equal((await prisma.assignment.findUniqueOrThrow({ where: { id: assignment.id } })).status, "EXPIRED");
  });

  test("coordinators can cancel; the report becomes claimable again", async () => {
    const reportId = await verifiedReport();
    const assignment = dataOf<Assignment>(await claim(reportId, team.A, ownerA.token));

    assertError(await api("POST", `/assignments/${assignment.id}/cancel`, teamMemberA.token), 403, "FORBIDDEN");
    assert.equal(dataOf<Assignment>(await api("POST", `/assignments/${assignment.id}/cancel`, coordinatorA.token)).status, "CANCELLED");
    assertError(await api("POST", `/assignments/${assignment.id}/cancel`, coordinatorA.token), 409, "ASSIGNMENT_INVALID_TRANSITION");
    assert.equal(await reportStatus(reportId), "VERIFIED");
    dataOf(await claim(reportId, team.B, ownerB.token));
  });
});

describe("event reports", () => {
  test("event reports are claimed through the event, without opportunities", async () => {
    const event = dataOf<{ id: string }>(
      await api("POST", "/events", ownerA.token, { organizationId: org.A, title: "Clean-up drive", startsAt: "2026-12-01T09:00:00Z" })
    );
    const report = await submit(SHIVAJINAGAR, { eventId: event.id });

    assertError(await claim(report.id, team.A, ownerA.token), 409, "REPORT_NOT_CLAIMABLE"); // not verified yet
    await verify(report.id);
    assert.equal(await prisma.reportOpportunity.count({ where: { reportId: report.id } }), 0);

    // B matches by category and area but is not in the event.
    assertError(await claim(report.id, team.B, ownerB.token), 404, "REPORT_NOT_FOUND");
    assert.equal(dataOf<Assignment>(await claim(report.id, team.A, ownerA.token)).status, "CLAIMED");
  });
});

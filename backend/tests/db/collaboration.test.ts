// HTTP + database tests for phase 4 core and the phase 3 transfer:
// transfer, collaboration, comments, notifications, and the endpoints the
// web app relies on (me, my organizations, organization detail, add by email).
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

const RUN = `test-collab-${Date.now()}`;
const PUNE_SQUARE = [[73.8, 18.48], [73.92, 18.48], [73.92, 18.58], [73.8, 18.58], [73.8, 18.48]];
const SHIVAJINAGAR = { lat: 18.5204, lng: 73.8567 };

type Assignment = { id: string; status: string; teamId: string; organizationId: string; supersedesAssignmentId: string | null };
type Collaboration = { id: string; status: string; teams: { team: { id: string } }[] };
type Notification = { type: string; title: string; reportId: string | null; readAt: string | null; id: string };

let server: Awaited<ReturnType<typeof startServer>>;
let reporter: TestUser;
let verifier: TestUser;
let ownerA: TestUser;
let ownerB: TestUser;
let memberB: TestUser;
let ownerC: TestUser;
const org = { A: "", B: "", C: "" };
const team = { A1: "", A2: "", B: "", C: "" };
let categoryId = "";

const api = (method: "GET" | "POST", path: string, token: string, body?: unknown) =>
  request(server.baseUrl, method, `/api/v1${path}`, { token, body });

const notifications = async (user: TestUser) =>
  dataOf<{ items: Notification[]; unread: number }>(await api("GET", "/notifications", user.token));

// A verified report claimed by team A1 (org A); org B and C also match it.
const claimedByA = async () => {
  const report = dataOf<{ id: string }>(
    await api("POST", "/reports", reporter.token, { title: "Fallen tree", description: "Blocking the lane", categoryId, location: SHIVAJINAGAR })
  );
  dataOf(await api("POST", `/reports/${report.id}/start-review`, verifier.token));
  dataOf(await api("POST", `/reports/${report.id}/verify`, verifier.token));
  const assignment = dataOf<Assignment>(await api("POST", `/reports/${report.id}/assignments/claim`, ownerA.token, { teamId: team.A1 }));
  return { reportId: report.id, assignmentId: assignment.id };
};

before(async () => {
  server = await startServer();
  [reporter, ownerA, ownerB, memberB, ownerC] = await Promise.all(
    ["reporter", "owner-a", "owner-b", "member-b", "owner-c"].map((label) => createUser(RUN, label))
  );
  verifier = await createUser(RUN, "verifier", { isPlatformAdmin: true });
  categoryId = (await prisma.category.create({ data: { name: "Trees", slug: `${RUN}-trees` } })).id;

  for (const [key, owner] of [["A", ownerA], ["B", ownerB], ["C", ownerC]] as const) {
    org[key] = (await createOrganization(owner.id, { name: `${RUN}-${key}` })).id;
    await prisma.organizationCategory.create({ data: { organizationId: org[key], categoryId } });
    dataOf(
      await api("POST", `/organizations/${org[key]}/service-areas`, owner.token, {
        name: "Pune",
        area: { type: "Polygon", coordinates: [PUNE_SQUARE] },
      })
    );
  }
  await prisma.organizationMembership.create({ data: { organizationId: org.B, userId: memberB.id, role: OrganizationRole.MEMBER } });

  const mkTeam = async (organizationId: string, name: string, createdByUserId: string) =>
    (await prisma.team.create({ data: { organizationId, name, createdByUserId } })).id;
  team.A1 = await mkTeam(org.A, "A One", ownerA.id);
  team.A2 = await mkTeam(org.A, "A Two", ownerA.id);
  team.B = await mkTeam(org.B, "B Team", ownerB.id);
  team.C = await mkTeam(org.C, "C Team", ownerC.id);
});

after(async () => {
  await server.close();
  await cleanupRun(RUN);
  await prisma.$disconnect();
});

describe("transfer", () => {
  test("hands an active assignment to another team in one step", async () => {
    const { reportId, assignmentId } = await claimedByA();

    const next = dataOf<Assignment>(await api("POST", `/assignments/${assignmentId}/transfer`, ownerA.token, { teamId: team.B }));
    assert.equal(next.status, "CLAIMED");
    assert.equal(next.organizationId, org.B);
    assert.equal(next.supersedesAssignmentId, assignmentId);
    assert.equal((await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } })).status, "TRANSFERRED");
    assert.equal(await prisma.assignment.count({ where: { reportId, endedAt: null } }), 1);

    // The old lead can no longer transfer; the new lead can work on it.
    assertError(await api("POST", `/assignments/${assignmentId}/transfer`, ownerA.token, { teamId: team.A2 }), 409, "ASSIGNMENT_INVALID_TRANSITION");
    assert.equal(dataOf<Assignment>(await api("POST", `/assignments/${next.id}/start`, ownerB.token)).status, "IN_PROGRESS");
  });

  test("transfer rules", async () => {
    const { assignmentId } = await claimedByA();
    assertError(await api("POST", `/assignments/${assignmentId}/transfer`, ownerA.token, { teamId: team.A1 }), 422, "TRANSFER_SAME_TEAM");
    assertError(await api("POST", `/assignments/${assignmentId}/transfer`, ownerB.token, { teamId: team.B }), 404, "ASSIGNMENT_NOT_FOUND");

    const outsiderOrg = await createOrganization(ownerC.id, { name: `${RUN}-no-match` });
    const outsiderTeam = await prisma.team.create({ data: { organizationId: outsiderOrg.id, name: "Far", createdByUserId: ownerC.id } });
    assertError(await api("POST", `/assignments/${assignmentId}/transfer`, ownerA.token, { teamId: outsiderTeam.id }), 422, "TEAM_NOT_ELIGIBLE");

    // Within the same organization works too.
    assert.equal(dataOf<Assignment>(await api("POST", `/assignments/${assignmentId}/transfer`, ownerA.token, { teamId: team.A2 })).teamId, team.A2);
  });
});

describe("collaboration", () => {
  test("invite → accept → nominate teams; collaborators can see and comment", async () => {
    const { reportId, assignmentId } = await claimedByA();

    const invited = dataOf<Collaboration>(await api("POST", `/assignments/${assignmentId}/collaborations`, ownerA.token, { organizationId: org.B }));
    assert.equal(invited.status, "INVITED");
    assert.ok((await notifications(ownerB)).items.some((n) => n.type === "COLLABORATION_INVITED" && n.reportId === reportId));

    assertError(await api("POST", `/collaborations/${invited.id}/teams`, ownerB.token, { teamId: team.B }), 409, "COLLABORATION_NOT_ACCEPTED");
    assertError(await api("POST", `/collaborations/${invited.id}/accept`, memberB.token), 403, "FORBIDDEN");
    assertError(await api("POST", `/collaborations/${invited.id}/accept`, ownerC.token), 404, "COLLABORATION_NOT_FOUND");

    assert.equal(dataOf<Collaboration>(await api("POST", `/collaborations/${invited.id}/accept`, ownerB.token)).status, "ACCEPTED");
    assertError(await api("POST", `/collaborations/${invited.id}/decline`, ownerB.token), 409, "COLLABORATION_NOT_PENDING");

    const nominated = dataOf<Collaboration>(await api("POST", `/collaborations/${invited.id}/teams`, ownerB.token, { teamId: team.B }));
    assert.deepEqual(nominated.teams.map((t) => t.team.id), [team.B]);
    dataOf(await api("POST", `/collaborations/${invited.id}/teams`, ownerB.token, { teamId: team.B })); // idempotent
    assertError(await api("POST", `/collaborations/${invited.id}/teams`, ownerB.token, { teamId: team.A1 }), 422, "TEAM_NOT_AVAILABLE");

    // Collaborators (even plain members) can view and comment.
    dataOf(await api("GET", `/reports/${reportId}`, memberB.token));
    dataOf(await api("POST", `/reports/${reportId}/comments`, memberB.token, { body: "We can bring a chainsaw" }));

    const listed = dataOf<{ id: string }[]>(await api("GET", `/collaborations?organizationId=${org.A}`, ownerA.token));
    assert.ok(listed.some((c) => c.id === invited.id));
  });

  test("invitation rules, and transfer revokes collaborator access", async () => {
    const { reportId, assignmentId } = await claimedByA();
    assertError(await api("POST", `/assignments/${assignmentId}/collaborations`, ownerA.token, { organizationId: org.A }), 422, "COLLABORATION_SELF");
    assertError(await api("POST", `/assignments/${assignmentId}/collaborations`, ownerB.token, { organizationId: org.C }), 404, "ASSIGNMENT_NOT_FOUND");

    const invited = dataOf<Collaboration>(await api("POST", `/assignments/${assignmentId}/collaborations`, ownerA.token, { organizationId: org.C }));
    dataOf(await api("POST", `/collaborations/${invited.id}/accept`, ownerC.token));

    dataOf(await api("POST", `/assignments/${assignmentId}/transfer`, ownerA.token, { teamId: team.A2 }));
    assert.equal((await prisma.assignmentCollaboration.findUniqueOrThrow({ where: { id: invited.id } })).status, "REVOKED");

    // C still sees the report only because it was offered it (opportunity),
    // but it can no longer act as a collaborator.
    assertError(await api("POST", `/collaborations/${invited.id}/teams`, ownerC.token, { teamId: team.C }), 409, "COLLABORATION_NOT_ACCEPTED");
    dataOf(await api("GET", `/reports/${reportId}`, ownerC.token));
  });
});

describe("comments and notifications", () => {
  test("comments are visible to anyone who can see the report and notify the reporter", async () => {
    const { reportId } = await claimedByA();
    const outsider = await createUser(RUN, "outsider");

    dataOf(await api("POST", `/reports/${reportId}/comments`, ownerA.token, { body: "On our way" }));
    assertError(await api("POST", `/reports/${reportId}/comments`, outsider.token, { body: "Hi" }), 404, "REPORT_NOT_FOUND");
    assertError(await api("POST", `/reports/${reportId}/comments`, ownerA.token, { body: "  " }), 422, "VALIDATION_FAILED");

    const comments = dataOf<{ body: string; author: { name: string } }[]>(await api("GET", `/reports/${reportId}/comments`, reporter.token));
    assert.deepEqual(comments.map((c) => c.body), ["On our way"]);
    assert.equal(comments[0]!.author.name, "owner-a");
  });

  test("the reporter is notified at each step and can mark notifications read", async () => {
    const { reportId } = await claimedByA();
    const types = (await notifications(reporter)).items.filter((n) => n.reportId === reportId).map((n) => n.type);
    assert.ok(types.includes("REPORT_UNDER_REVIEW"));
    assert.ok(types.includes("REPORT_VERIFIED"));
    assert.ok(types.includes("REPORT_CLAIMED"));

    // Matching organizations' coordinators were told about the opportunity.
    assert.ok((await notifications(ownerC)).items.some((n) => n.type === "REPORT_OPPORTUNITY" && n.reportId === reportId));
    // Plain members are not.
    assert.ok(!(await notifications(memberB)).items.some((n) => n.type === "REPORT_OPPORTUNITY" && n.reportId === reportId));

    const first = (await notifications(reporter)).items[0]!;
    assert.equal((await api("POST", `/notifications/${first.id}/read`, reporter.token)).status, 204);
    // Another user's notification id is a no-op.
    assert.equal((await api("POST", `/notifications/${first.id}/read`, ownerA.token)).status, 204);
    assert.equal((await api("POST", "/notifications/read-all", reporter.token)).status, 204);
    assert.equal((await notifications(reporter)).unread, 0);
  });
});

describe("web app support endpoints", () => {
  test("me, my organizations, organization detail and add member by email", async () => {
    const me = dataOf<{ email: string; isPlatformAdmin: boolean }>(await api("GET", "/auth/me", verifier.token));
    assert.equal(me.email, verifier.email);
    assert.equal(me.isPlatformAdmin, true);

    const mine = dataOf<{ organization: { id: string }; role: string }[]>(await api("GET", "/organizations", ownerA.token));
    assert.ok(mine.some((m) => m.organization.id === org.A && m.role === "OWNER"));

    const newcomer = await createUser(RUN, "newcomer");
    dataOf(await api("POST", `/organizations/${org.A}/members`, ownerA.token, { email: newcomer.email, role: "COORDINATOR" }));
    assertError(await api("POST", `/organizations/${org.A}/members`, ownerA.token, { email: newcomer.email }), 409, "MEMBER_ALREADY_EXISTS");
    assertError(await api("POST", `/organizations/${org.A}/members`, ownerA.token, { email: `${RUN}-ghost@openfield.test` }), 404, "USER_NOT_FOUND");
    assertError(await api("POST", `/organizations/${org.A}/members`, ownerA.token, { role: "MEMBER" }), 422, "VALIDATION_FAILED");

    const detail = dataOf<{ myRole: string; memberships: { user: { email: string } }[]; teams: { id: string }[] }>(
      await api("GET", `/organizations/${org.A}`, newcomer.token)
    );
    assert.equal(detail.myRole, "COORDINATOR");
    assert.ok(detail.memberships.some((m) => m.user.email === newcomer.email));
    assert.deepEqual(detail.teams.map((t) => t.id).sort(), [team.A1, team.A2].sort());
    assertError(await api("GET", `/organizations/${org.A}`, ownerB.token), 403, "FORBIDDEN");

    dataOf(await api("GET", `/organizations/${org.A}/assignments`, ownerA.token));
    const others = dataOf<{ id: string }[]>(await api("GET", `/organizations/${org.A}/other-organizations`, ownerA.token));
    assert.ok(others.some((o) => o.id === org.B) && !others.some((o) => o.id === org.A));
  });
});

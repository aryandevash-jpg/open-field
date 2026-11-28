// HTTP + database tests for events and organization participation.
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

const RUN = `test-events-${Date.now()}`;
const MISSING_ID = "00000000-0000-0000-0000-000000000000";

type Event = { id: string; status: string; hostOrganizationId: string; title: string };
type Participation = { eventId: string; organizationId: string; status: string; reviewedByUserId: string | null };

let server: Awaited<ReturnType<typeof startServer>>;
let hostOwner: TestUser;
let hostMember: TestUser;
let partnerOwner: TestUser;
let partnerMember: TestUser;
let pendingOwner: TestUser;
let outsider: TestUser;
let hostOrgId = "";
let partnerOrgId = "";
let pendingOrgId = "";
let categoryId = "";

const api = (method: "GET" | "POST" | "PATCH", path: string, token: string, body?: unknown) =>
  request(server.baseUrl, method, `/api/v1/events${path}`, { token, body });

const createEvent = async (title = "Save Our Lake") =>
  dataOf<Event>(
    await api("POST", "", hostOwner.token, { organizationId: hostOrgId, title, startsAt: "2026-12-01T09:00:00Z" })
  );

const addMember = (organizationId: string, user: TestUser) =>
  prisma.organizationMembership.create({ data: { organizationId, userId: user.id, role: OrganizationRole.MEMBER } });

before(async () => {
  server = await startServer();
  [hostOwner, hostMember, partnerOwner, partnerMember, pendingOwner, outsider] = await Promise.all(
    ["host-owner", "host-member", "partner-owner", "partner-member", "pending-owner", "outsider"].map((label) =>
      createUser(RUN, label)
    )
  );
  hostOrgId = (await createOrganization(hostOwner.id, { name: `${RUN}-host` })).id;
  partnerOrgId = (await createOrganization(partnerOwner.id, { name: `${RUN}-partner` })).id;
  pendingOrgId = (await createOrganization(pendingOwner.id, { name: `${RUN}-pending` })).id;
  await addMember(hostOrgId, hostMember);
  await addMember(partnerOrgId, partnerMember);
  categoryId = (await prisma.category.create({ data: { name: RUN, slug: `${RUN}-cat` } })).id;
});

after(async () => {
  await server.close();
  await cleanupRun(RUN);
  await prisma.$disconnect();
});

describe("events", () => {
  test("a host owner creates, edits and lists an event", async () => {
    const event = await createEvent();
    assert.equal(event.status, "ACTIVE");
    assert.equal(event.hostOrganizationId, hostOrgId);

    const renamed = dataOf<Event>(await api("PATCH", `/${event.id}`, hostOwner.token, { title: "Save Our Lake 2026" }));
    assert.equal(renamed.title, "Save Our Lake 2026");

    // Any signed-in user can discover active events.
    const listed = dataOf<Event[]>(await api("GET", "", outsider.token));
    assert.ok(listed.some((item) => item.id === event.id));
    dataOf(await api("GET", `/${event.id}`, outsider.token));
  });

  test("only host managers can create or edit", async () => {
    const event = await createEvent();
    const body = { organizationId: hostOrgId, title: "Nope", startsAt: "2026-12-01T09:00:00Z" };
    assertError(await api("POST", "", hostMember.token, body), 403, "FORBIDDEN");
    assertError(await api("POST", "", outsider.token, body), 403, "FORBIDDEN");
    assertError(await api("PATCH", `/${event.id}`, partnerOwner.token, { title: "Hijack" }), 403, "FORBIDDEN");
  });

  test("dates are validated by zod on create and by the database on partial edits", async () => {
    assertError(
      await api("POST", "", hostOwner.token, {
        organizationId: hostOrgId,
        title: "Backwards",
        startsAt: "2026-12-02T00:00:00Z",
        endsAt: "2026-12-01T00:00:00Z",
      }),
      422,
      "VALIDATION_FAILED"
    );
    const event = await createEvent();
    assertError(
      await api("PATCH", `/${event.id}`, hostOwner.token, { endsAt: "2026-11-01T00:00:00Z" }),
      422,
      "EVENT_INVALID_DATES"
    );
    assertError(await api("GET", `/${MISSING_ID}`, outsider.token), 404, "EVENT_NOT_FOUND");
  });
});

describe("participation", () => {
  test("request, approve, and idempotent re-request", async () => {
    const event = await createEvent();
    const path = `/${event.id}/participation-requests`;

    const requested = dataOf<Participation>(await api("POST", path, partnerOwner.token, { organizationId: partnerOrgId }));
    assert.equal(requested.status, "PENDING");
    const again = dataOf<Participation>(await api("POST", path, partnerOwner.token, { organizationId: partnerOrgId }));
    assert.equal(again.status, "PENDING");

    const approved = dataOf<Participation>(
      await api("POST", `/${event.id}/participations/${partnerOrgId}/approve`, hostOwner.token)
    );
    assert.equal(approved.status, "APPROVED");
    assert.equal(approved.reviewedByUserId, hostOwner.id);

    assertError(
      await api("POST", `/${event.id}/participations/${partnerOrgId}/approve`, hostOwner.token),
      409,
      "PARTICIPATION_NOT_PENDING"
    );
    // Re-requesting after approval changes nothing.
    const stillApproved = dataOf<Participation>(await api("POST", path, partnerOwner.token, { organizationId: partnerOrgId }));
    assert.equal(stillApproved.status, "APPROVED");
  });

  test("a rejected organization can ask again", async () => {
    const event = await createEvent();
    const path = `/${event.id}/participation-requests`;
    dataOf(await api("POST", path, partnerOwner.token, { organizationId: partnerOrgId }));
    const rejected = dataOf<Participation>(
      await api("POST", `/${event.id}/participations/${partnerOrgId}/reject`, hostOwner.token)
    );
    assert.equal(rejected.status, "REJECTED");

    const reopened = dataOf<Participation>(await api("POST", path, partnerOwner.token, { organizationId: partnerOrgId }));
    assert.equal(reopened.status, "PENDING");
    assert.equal(reopened.reviewedByUserId, null);
  });

  test("permission and business rules", async () => {
    const event = await createEvent();
    const path = `/${event.id}/participation-requests`;

    assertError(await api("POST", path, partnerMember.token, { organizationId: partnerOrgId }), 403, "FORBIDDEN");
    assertError(await api("POST", path, hostOwner.token, { organizationId: hostOrgId }), 422, "EVENT_HOST_CANNOT_PARTICIPATE");

    dataOf(await api("POST", path, partnerOwner.token, { organizationId: partnerOrgId }));
    // Only the host reviews; the requester cannot approve itself.
    assertError(await api("POST", `/${event.id}/participations/${partnerOrgId}/approve`, partnerOwner.token), 403, "FORBIDDEN");
    assertError(
      await api("POST", `/${event.id}/participations/${pendingOrgId}/approve`, hostOwner.token),
      404,
      "PARTICIPATION_NOT_FOUND"
    );

    // Host members can see the request list; others cannot.
    const list = dataOf<Participation[]>(await api("GET", `/${event.id}/participations`, hostMember.token));
    assert.deepEqual(list.map((item) => item.organizationId), [partnerOrgId]);
    assertError(await api("GET", `/${event.id}/participations`, partnerOwner.token), 403, "FORBIDDEN");
  });

  test("a completed event accepts no new requests or reports", async () => {
    const event = await createEvent();
    const completed = dataOf<Event>(await api("POST", `/${event.id}/complete`, hostOwner.token));
    assert.equal(completed.status, "COMPLETED");
    assertError(await api("POST", `/${event.id}/complete`, hostOwner.token), 409, "EVENT_NOT_ACTIVE");

    assertError(
      await api("POST", `/${event.id}/participation-requests`, partnerOwner.token, { organizationId: partnerOrgId }),
      409,
      "EVENT_NOT_ACTIVE"
    );
    assertError(
      await request(server.baseUrl, "POST", "/api/v1/reports", {
        token: outsider.token,
        body: { title: "Late", description: "x", categoryId, location: { lat: 18.52, lng: 73.85 }, eventId: event.id },
      }),
      409,
      "EVENT_NOT_ACTIVE"
    );
  });
});

describe("event report visibility", () => {
  test("host and approved participants see event reports; pending and outsiders do not", async () => {
    const event = await createEvent();
    const requestPath = `/${event.id}/participation-requests`;
    dataOf(await api("POST", requestPath, partnerOwner.token, { organizationId: partnerOrgId }));
    dataOf(await api("POST", `/${event.id}/participations/${partnerOrgId}/approve`, hostOwner.token));
    dataOf(await api("POST", requestPath, pendingOwner.token, { organizationId: pendingOrgId }));

    // A community member (outsider to every org) reports into the event.
    const report = dataOf<{ id: string }>(
      await request(server.baseUrl, "POST", "/api/v1/reports", {
        token: outsider.token,
        body: { title: "Plastic on shore", description: "Near the ghat", categoryId, location: { lat: 18.52, lng: 73.85 }, eventId: event.id },
      })
    );

    for (const viewer of [hostMember, partnerMember]) {
      const listed = dataOf<{ id: string }[]>(await api("GET", `/${event.id}/reports`, viewer.token));
      assert.deepEqual(listed.map((item) => item.id), [report.id]);
      dataOf(await request(server.baseUrl, "GET", `/api/v1/reports/${report.id}`, { token: viewer.token }));
    }

    assertError(await api("GET", `/${event.id}/reports`, pendingOwner.token), 403, "FORBIDDEN");
    assertError(
      await request(server.baseUrl, "GET", `/api/v1/reports/${report.id}`, { token: pendingOwner.token }),
      404,
      "REPORT_NOT_FOUND"
    );
  });
});

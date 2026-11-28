// HTTP + database tests for report submission, visibility and verification.
//
//   npm run test:db

import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { prisma } from "../../src/lib/prisma.js";
import { cleanupRun } from "../helpers/cleanup.js";
import { assertError, createUser, dataOf, request, startServer, type TestUser } from "../helpers/http.js";

const RUN = `test-reports-${Date.now()}`;
const MISSING_ID = "00000000-0000-0000-0000-000000000000";
const SHIVAJINAGAR = { lat: 18.5204, lng: 73.8567 };

type Report = {
  id: string;
  status: string;
  version: number;
  location: { lat: number; lng: number };
  submittedByUserId: string;
  duplicateOfReportId: string | null;
  media?: { url: string; contentType: string | null }[];
};
type HistoryEntry = { action: string; fromStatus: string | null; toStatus: string | null; reason: string | null };

let server: Awaited<ReturnType<typeof startServer>>;
let reporter: TestUser;
let otherUser: TestUser;
let verifier: TestUser;
let categoryId = "";
let inactiveCategoryId = "";

const api = (method: "GET" | "POST", path: string, token: string, body?: unknown) =>
  request(server.baseUrl, method, `/api/v1/reports${path}`, { token, body });

const submit = async (overrides: Record<string, unknown> = {}) =>
  dataOf<Report>(
    await api("POST", "", reporter.token, {
      title: "Blocked drain",
      description: "Water pooling on the road",
      categoryId,
      location: SHIVAJINAGAR,
      ...overrides,
    })
  );

const act = (reportId: string, action: string, body?: unknown, token = verifier.token) =>
  api("POST", `/${reportId}/${action}`, token, body);

const history = async (reportId: string) =>
  dataOf<HistoryEntry[]>(await api("GET", `/${reportId}/history`, reporter.token));

before(async () => {
  server = await startServer();
  reporter = await createUser(RUN, "reporter");
  otherUser = await createUser(RUN, "other");
  verifier = await createUser(RUN, "verifier", { isPlatformAdmin: true });
  categoryId = (await prisma.category.create({ data: { name: RUN, slug: `${RUN}-drains` } })).id;
  inactiveCategoryId = (
    await prisma.category.create({ data: { name: RUN, slug: `${RUN}-retired`, isActive: false } })
  ).id;
});

after(async () => {
  await server.close();
  await cleanupRun(RUN);
  await prisma.$disconnect();
});

describe("report submission", () => {
  test("creates a SUBMITTED report with location, media and a history entry", async () => {
    const report = await submit({
      media: [{ url: "https://cdn.example.org/drain.jpg", contentType: "image/jpeg" }],
    });
    assert.equal(report.status, "SUBMITTED");
    assert.equal(report.version, 1);
    assert.equal(report.submittedByUserId, reporter.id);
    assert.ok(Math.abs(report.location.lat - SHIVAJINAGAR.lat) < 1e-9);
    assert.ok(Math.abs(report.location.lng - SHIVAJINAGAR.lng) < 1e-9);
    assert.deepEqual(report.media?.map((media) => media.url), ["https://cdn.example.org/drain.jpg"]);

    const entries = await history(report.id);
    assert.deepEqual(entries.map((entry) => [entry.action, entry.toStatus]), [["SUBMITTED", "SUBMITTED"]]);
  });

  test("rejects unknown or inactive categories and bad input", async () => {
    const body = (overrides: Record<string, unknown>) => ({
      title: "Blocked drain",
      description: "x",
      categoryId,
      location: SHIVAJINAGAR,
      ...overrides,
    });
    assertError(await api("POST", "", reporter.token, body({ categoryId: MISSING_ID })), 404, "CATEGORY_NOT_FOUND");
    assertError(await api("POST", "", reporter.token, body({ categoryId: inactiveCategoryId })), 422, "CATEGORY_INACTIVE");
    assertError(await api("POST", "", reporter.token, body({ eventId: MISSING_ID })), 404, "EVENT_NOT_FOUND");
    assertError(await api("POST", "", reporter.token, body({ location: { lat: 200, lng: 73 } })), 422, "VALIDATION_FAILED");
    assertError(await api("POST", "", reporter.token, body({ media: [{ url: "ftp://x.org/a.jpg" }] })), 422, "VALIDATION_FAILED");
    assertError(await api("POST", "", reporter.token, body({ status: "VERIFIED", title: "" })), 422, "VALIDATION_FAILED");
  });

  test("clients cannot set status: unknown fields are ignored", async () => {
    const report = await submit({ status: "VERIFIED", version: 99 });
    assert.equal(report.status, "SUBMITTED");
    assert.equal(report.version, 1);
  });
});

describe("report visibility", () => {
  test("submitter and verifiers see a report; other users get 404", async () => {
    const report = await submit();
    dataOf(await api("GET", `/${report.id}`, reporter.token));
    dataOf(await api("GET", `/${report.id}`, verifier.token));
    assertError(await api("GET", `/${report.id}`, otherUser.token), 404, "REPORT_NOT_FOUND");
    assertError(await api("GET", `/${report.id}/history`, otherUser.token), 404, "REPORT_NOT_FOUND");
  });

  test("users list their own reports; verifiers list all and filter by status", async () => {
    const report = await submit();
    const mine = dataOf<Report[]>(await api("GET", "", reporter.token));
    assert.ok(mine.some((item) => item.id === report.id));
    assert.ok(mine.every((item) => item.submittedByUserId === reporter.id));
    assert.ok(!dataOf<Report[]>(await api("GET", "", otherUser.token)).some((item) => item.id === report.id));

    const queue = dataOf<Report[]>(await api("GET", "?status=SUBMITTED&limit=100", verifier.token));
    assert.ok(queue.every((item) => item.status === "SUBMITTED"));
    assertError(await api("GET", "?status=NOPE", verifier.token), 422, "VALIDATION_FAILED");
  });
});

describe("verification", () => {
  test("review then verify, with history and version", async () => {
    const report = await submit();
    assertError(await act(report.id, "verify"), 409, "REPORT_INVALID_TRANSITION"); // must be reviewed first

    assert.equal(dataOf<Report>(await act(report.id, "start-review")).status, "UNDER_REVIEW");
    const verified = dataOf<Report>(await act(report.id, "verify", { reason: "Photo confirms it" }));
    assert.equal(verified.status, "VERIFIED");
    assert.equal(verified.version, 3);

    assert.deepEqual(
      (await history(report.id)).map((entry) => [entry.action, entry.fromStatus, entry.toStatus]),
      [
        ["SUBMITTED", null, "SUBMITTED"],
        ["START_REVIEW", "SUBMITTED", "UNDER_REVIEW"],
        ["VERIFY", "UNDER_REVIEW", "VERIFIED"],
      ]
    );
  });

  test("only verifiers can run commands", async () => {
    const report = await submit();
    assertError(await act(report.id, "start-review", undefined, reporter.token), 403, "FORBIDDEN");
    assertError(await act(MISSING_ID, "start-review"), 404, "REPORT_NOT_FOUND");
  });

  test("reject and request-information require a reason; rejected is final", async () => {
    const report = await submit();
    dataOf(await act(report.id, "start-review"));
    assertError(await act(report.id, "reject"), 422, "VALIDATION_FAILED");

    const rejected = dataOf<Report>(await act(report.id, "reject", { reason: "Outside our scope" }));
    assert.equal(rejected.status, "REJECTED");
    assertError(await act(report.id, "start-review"), 409, "REPORT_INVALID_TRANSITION");
    assert.equal((await history(report.id)).at(-1)?.reason, "Outside our scope");
  });

  test("request-information sends the report back to SUBMITTED", async () => {
    const report = await submit();
    dataOf(await act(report.id, "start-review"));
    assertError(await act(report.id, "request-information", {}), 422, "VALIDATION_FAILED");
    const back = dataOf<Report>(await act(report.id, "request-information", { reason: "Please add a closer photo" }));
    assert.equal(back.status, "SUBMITTED");
    assert.equal(dataOf<Report>(await act(report.id, "start-review")).status, "UNDER_REVIEW");
  });

  test("mark-duplicate links to an existing, different report", async () => {
    const canonical = await submit();
    const duplicate = await submit();
    dataOf(await act(duplicate.id, "start-review"));

    assertError(await act(duplicate.id, "mark-duplicate", { duplicateOfReportId: duplicate.id }), 422, "DUPLICATE_TARGET_INVALID");
    assertError(await act(duplicate.id, "mark-duplicate", { duplicateOfReportId: MISSING_ID }), 422, "DUPLICATE_TARGET_INVALID");

    const marked = dataOf<Report>(await act(duplicate.id, "mark-duplicate", { duplicateOfReportId: canonical.id }));
    assert.equal(marked.status, "DUPLICATE");
    assert.equal(marked.duplicateOfReportId, canonical.id);
  });

  test("two verifiers acting at once: exactly one succeeds", async () => {
    const report = await submit();
    dataOf(await act(report.id, "start-review"));

    const results = await Promise.all([act(report.id, "verify"), act(report.id, "reject", { reason: "Not an issue" })]);
    const statuses = results.map((result) => result.status).sort();
    assert.deepEqual(statuses, [200, 409]);

    const entries = await history(report.id);
    assert.equal(entries.length, 3, "only the winning command is recorded");
  });

  test("the database refuses a DUPLICATE without a canonical report", async () => {
    const report = await submit();
    await assert.rejects(prisma.report.update({ where: { id: report.id }, data: { status: "DUPLICATE" } }));
  });
});

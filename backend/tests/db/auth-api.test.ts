// HTTP integration tests for /api/v1/auth after moving to the central error handler.
//
//   npm run test:db

import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { prisma } from "../../src/lib/prisma.js";
import { assertError, dataOf, request, startServer } from "../helpers/http.js";

const RUN = `test-authapi-${Date.now()}`;
const email = `${RUN}@openfield.test`;
const password = "correct-horse-battery";

let server: Awaited<ReturnType<typeof startServer>>;

before(async () => {
  server = await startServer();
});

after(async () => {
  await server.close();
  await prisma.user.deleteMany({ where: { email: { startsWith: RUN } } });
  await prisma.$disconnect();
});

describe("auth API", () => {
  test("register, then log in with the same credentials", async () => {
    const user = dataOf<{ id: string; email: string; passwordHash?: string }>(
      await request(server.baseUrl, "POST", "/api/v1/auth/register", { body: { name: "Tester", email, password } })
    );
    assert.equal(user.email, email);
    assert.equal(user.passwordHash, undefined, "password hash must never be returned");

    const login = dataOf<{ token: string }>(
      await request(server.baseUrl, "POST", "/api/v1/auth/login", { body: { email, password } })
    );
    assert.equal(typeof login.token, "string");
  });

  test("registering the same email twice returns 409", async () => {
    assertError(
      await request(server.baseUrl, "POST", "/api/v1/auth/register", { body: { name: "Again", email, password } }),
      409,
      "EMAIL_ALREADY_REGISTERED"
    );
  });

  test("a wrong password and an unknown email look identical", async () => {
    assertError(
      await request(server.baseUrl, "POST", "/api/v1/auth/login", { body: { email, password: "wrong-password" } }),
      401,
      "INVALID_CREDENTIALS"
    );
    assertError(
      await request(server.baseUrl, "POST", "/api/v1/auth/login", {
        body: { email: `${RUN}-nobody@openfield.test`, password },
      }),
      401,
      "INVALID_CREDENTIALS"
    );
  });

  test("invalid registration input returns 422", async () => {
    assertError(
      await request(server.baseUrl, "POST", "/api/v1/auth/register", {
        body: { name: "x", email: "not-an-email", password: "short" },
      }),
      422,
      "VALIDATION_FAILED"
    );
  });
});

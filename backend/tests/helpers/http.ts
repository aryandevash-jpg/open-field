// Shared helpers for HTTP integration tests: start the real Express app on a
// random port, create tagged users with tokens, and send JSON requests.

import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import app from "../../src/app.js";
import { env } from "../../src/config/env.js";
import { prisma } from "../../src/lib/prisma.js";

export type TestUser = { id: string; email: string; token: string };
export type ApiResponse = { status: number; body: Record<string, unknown> | null };

export const startServer = async () => {
  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

export const createUser = async (
  tag: string,
  label: string,
  options: { isPlatformAdmin?: boolean } = {}
): Promise<TestUser> => {
  const email = `${tag}-${label}@openfield.test`;
  const user = await prisma.user.create({
    data: { name: label, email, passwordHash: "not-used", isPlatformAdmin: options.isPlatformAdmin ?? false },
  });
  return { id: user.id, email, token: jwt.sign({ userId: user.id }, env.JWT_SECRET) };
};

export const request = async (
  baseUrl: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  options: { token?: string; body?: unknown; rawBody?: string } = {}
): Promise<ApiResponse> => {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const payload = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  if (payload !== undefined) headers["content-type"] = "application/json";

  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
};

// Asserts the central error handler's shape: { success: false, code, message }.
export const assertError = (response: ApiResponse, status: number, code: string) => {
  assert.equal(response.status, status, `expected ${status} ${code}, got ${JSON.stringify(response.body)}`);
  assert.equal(response.body?.success, false);
  assert.equal(response.body?.code, code);
  assert.equal(typeof response.body?.message, "string");
};

// Returns `data` from a successful response.
export const dataOf = <T>(response: ApiResponse): T => {
  assert.ok(response.status < 300, `expected success, got ${response.status} ${JSON.stringify(response.body)}`);
  return response.body?.data as T;
};

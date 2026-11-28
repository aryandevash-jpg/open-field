// Unit tests: how the category service translates database errors.
// No database connection is made (Prisma connects lazily).
//
//   npm test

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Prisma } from "../../src/generated/prisma/client.js";
import { rethrowCategoryError } from "../../src/modules/category/category.service.js";

// Builds the error Prisma 7 + @prisma/adapter-pg raises for a PostgreSQL error.
const prismaError = (code: string, postgres?: { code: string; message: string }) =>
  new Prisma.PrismaClientKnownRequestError("test", {
    code,
    clientVersion: "test",
    meta: postgres
      ? {
          modelName: "Category",
          driverAdapterError: {
            name: "DriverAdapterError",
            cause: { originalCode: postgres.code, originalMessage: postgres.message, kind: "postgres" },
          },
        }
      : undefined,
  });

const translated = (error: unknown): unknown => {
  try {
    rethrowCategoryError(error);
  } catch (thrown) {
    return thrown;
  }
  assert.fail("rethrowCategoryError must always throw");
};

const assertTranslatesTo = (error: unknown, message: string) => {
  const result = translated(error);
  assert.ok(result instanceof Error);
  assert.equal(result.message, message);
  assert.equal(result.cause, error, "the original error is kept as cause");
};

describe("rethrowCategoryError", () => {
  for (const key of [
    "CATEGORY_HIERARCHY_CYCLE",
    "CATEGORY_PARENT_INACTIVE",
    "CATEGORY_HAS_ACTIVE_DESCENDANTS",
  ]) {
    test(`trigger message ${key} becomes the same application error`, () => {
      assertTranslatesTo(prismaError("P2039", { code: "23514", message: key }), key);
    });
  }

  test("the self-parent CHECK constraint is reported as a cycle", () => {
    assertTranslatesTo(
      prismaError("P2039", {
        code: "23514",
        message: 'new row for relation "Category" violates check constraint "Category_parentId_not_self_check"',
      }),
      "CATEGORY_HIERARCHY_CYCLE"
    );
  });

  test("Prisma codes map to application errors", () => {
    assertTranslatesTo(prismaError("P2025"), "CATEGORY_NOT_FOUND");
    assertTranslatesTo(prismaError("P2002"), "CATEGORY_SLUG_TAKEN");
    assertTranslatesTo(prismaError("P2003"), "CATEGORY_PARENT_NOT_FOUND");
    assertTranslatesTo(prismaError("P2034"), "CATEGORY_CONCURRENT_MODIFICATION");
  });

  test("an unrelated check violation is not mistaken for a hierarchy error", () => {
    const error = prismaError("P2039", { code: "23514", message: "some_other_check" });
    assert.equal(translated(error), error);
  });

  test("a trigger key under a different SQLSTATE is not trusted", () => {
    const error = prismaError("P2039", { code: "P0001", message: "CATEGORY_HIERARCHY_CYCLE" });
    assert.equal(translated(error), error);
  });

  test("unknown Prisma codes and non-Prisma errors are rethrown unchanged", () => {
    const unknownCode = prismaError("P2010");
    assert.equal(translated(unknownCode), unknownCode);

    const plain = new Error("boom");
    assert.equal(translated(plain), plain);
    assert.equal(translated("not an error"), "not an error");
  });
});

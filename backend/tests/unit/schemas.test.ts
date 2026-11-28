// Unit tests: request validation the category and capability code relies on.
//
//   npm test

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createCategorySchema,
  updateCategorySchema,
} from "../../src/modules/category/category.schema.js";
import { categoryCapabilityParamsSchema } from "../../src/modules/organizations/organization.schema.js";

const UUID = "3f1c2b9e-8d7a-4c6b-9e5f-1a2b3c4d5e6f";

describe("categoryCapabilityParamsSchema", () => {
  test("accepts two UUIDs", () => {
    const parsed = categoryCapabilityParamsSchema.safeParse({ organizationId: UUID, categoryId: UUID });
    assert.equal(parsed.success, true);
  });

  test("rejects malformed or missing IDs", () => {
    assert.equal(categoryCapabilityParamsSchema.safeParse({ organizationId: UUID, categoryId: "abc" }).success, false);
    assert.equal(categoryCapabilityParamsSchema.safeParse({ organizationId: "abc", categoryId: UUID }).success, false);
    assert.equal(categoryCapabilityParamsSchema.safeParse({ organizationId: UUID }).success, false);
  });
});

describe("createCategorySchema", () => {
  test("normalizes the slug and accepts an optional parent", () => {
    const parsed = createCategorySchema.parse({ name: " Plastic Waste ", slug: " Plastic-Waste ", parentId: UUID });
    assert.equal(parsed.name, "Plastic Waste");
    assert.equal(parsed.slug, "plastic-waste");
    assert.equal(parsed.parentId, UUID);
  });

  test("rejects invalid slugs and parent IDs", () => {
    assert.equal(createCategorySchema.safeParse({ name: "Waste", slug: "bad slug!" }).success, false);
    assert.equal(createCategorySchema.safeParse({ name: "Waste", slug: "waste", parentId: "1" }).success, false);
  });
});

describe("updateCategorySchema", () => {
  test("allows moving a category to the root with parentId null", () => {
    assert.deepEqual(updateCategorySchema.parse({ parentId: null }), { parentId: null });
  });

  test("rejects an empty update", () => {
    assert.equal(updateCategorySchema.safeParse({}).success, false);
  });

  test("does not accept isActive (activation has its own operation)", () => {
    const parsed = updateCategorySchema.parse({ name: "Water", isActive: false });
    assert.equal("isActive" in parsed, false);
  });
});

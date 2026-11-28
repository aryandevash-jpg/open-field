import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { checkViolationMessage } from "../../lib/prisma-errors.js";
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
} from "./category.schema.js";

// ------------------------------------
// Error translation
// ------------------------------------
//
// Hierarchy integrity (parent exists, no cycles, active => active parent,
// no deactivation with active descendants) is enforced by PostgreSQL; see
// prisma/migrations/20261127201815_enforce_category_hierarchy. The service
// performs the write and maps the database's rejection to a stable
// application error code. The original error is kept as `cause`.

// Messages raised by the hierarchy triggers with SQLSTATE 23514.
const HIERARCHY_VIOLATIONS = new Set([
  "CATEGORY_HIERARCHY_CYCLE",
  "CATEGORY_PARENT_INACTIVE",
  "CATEGORY_HAS_ACTIVE_DESCENDANTS",
]);

const SELF_PARENT_CHECK = "Category_parentId_not_self_check";

// Exported for unit tests; not part of the module's public workflow.
export const rethrowCategoryError = (error: unknown): never => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    throw error;
  }

  const checkMessage = checkViolationMessage(error);

  if (checkMessage !== undefined && HIERARCHY_VIOLATIONS.has(checkMessage)) {
    throw new Error(checkMessage, { cause: error });
  }

  if (checkMessage?.includes(SELF_PARENT_CHECK)) {
    throw new Error("CATEGORY_HIERARCHY_CYCLE", { cause: error });
  }

  switch (error.code) {
    case "P2025": // update target does not exist
      throw new Error("CATEGORY_NOT_FOUND", { cause: error });
    case "P2002": // the only business unique key on Category is slug
      throw new Error("CATEGORY_SLUG_TAKEN", { cause: error });
    case "P2003": // Category_parentId_fkey
      throw new Error("CATEGORY_PARENT_NOT_FOUND", { cause: error });
    case "P2034": // 40001 / 40P01: lost a race on the hierarchy lock; safe to retry
      throw new Error("CATEGORY_CONCURRENT_MODIFICATION", { cause: error });
    default:
      throw error;
  }
};

// ------------------------------------
// Create category
// ------------------------------------

export const createCategory = (data: CreateCategoryInput) =>
  prisma.category
    .create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description,
        parentId: data.parentId ?? null,
      },
    })
    .catch(rethrowCategoryError);

// ------------------------------------
// List categories
// ------------------------------------

export const listCategories = async (filters: {
  search?: string;
  includeInactive?: boolean;
  rootsOnly?: boolean;
}) => {
  return prisma.category.findMany({
    where: {
      ...(filters.includeInactive ? {} : { isActive: true }),

      ...(filters.rootsOnly ? { parentId: null } : {}),

      ...(filters.search
        ? {
            name: {
              contains: filters.search,
              mode: "insensitive",
            },
          }
        : {}),
    },

    orderBy: {
      name: "asc",
    },

    include: {
      parent: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  });
};

// ------------------------------------
// Get category by ID
// ------------------------------------

export const getCategoryById = async (id: string) => {
  const category = await prisma.category.findUnique({
    where: { id },

    include: {
      parent: true,
      children: {
        orderBy: {
          name: "asc",
        },
      },
    },
  });

  if (!category) {
    throw new Error("CATEGORY_NOT_FOUND");
  }

  return category;
};

// ------------------------------------
// Update category
// ------------------------------------

export const updateCategory = (id: string, data: UpdateCategoryInput) =>
  prisma.category
    .update({
      where: { id },
      data,
    })
    .catch(rethrowCategoryError);

// ------------------------------------
// Activate / Deactivate category
// ------------------------------------

// Strict semantics: descendants are never deactivated implicitly. Setting the
// current value is a no-op for the hierarchy triggers (their WHEN clauses
// compare OLD and NEW).
export const setCategoryActive = (id: string, isActive: boolean) =>
  prisma.category
    .update({
      where: { id },
      data: { isActive },
    })
    .catch(rethrowCategoryError);

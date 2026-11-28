import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "../generated/prisma/client.js";

// Services throw `new Error("CODE")`. This table is the single place that
// decides how each code is shown to API clients. Unknown errors become 500s.
const errorResponses: Record<string, { status: number; message: string }> = {
  // Auth & access
  INVALID_CREDENTIALS: { status: 401, message: "Invalid email or password" },
  EMAIL_ALREADY_REGISTERED: { status: 409, message: "Email already registered" },
  FORBIDDEN: { status: 403, message: "You do not have permission to perform this action" },

  // Organizations & teams
  INVALID_TEAM_MEMBERSHIP: {
    status: 422,
    message: "Team and membership must belong to the same active organization",
  },

  // Service areas
  SERVICE_AREA_INVALID: {
    status: 422,
    message: "Service area is not a valid shape (for example, its boundary crosses itself)",
  },

  // Categories
  CATEGORY_NOT_FOUND: { status: 404, message: "Category not found" },
  CATEGORY_INACTIVE: { status: 422, message: "Category is not active" },
  CATEGORY_PARENT_NOT_FOUND: { status: 422, message: "Parent category not found" },
  CATEGORY_SLUG_TAKEN: { status: 409, message: "A category with this slug already exists" },
  CATEGORY_HIERARCHY_CYCLE: {
    status: 409,
    message: "A category cannot be placed under itself or one of its descendants",
  },
  CATEGORY_PARENT_INACTIVE: { status: 409, message: "An active category cannot have an inactive parent" },
  CATEGORY_HAS_ACTIVE_DESCENDANTS: {
    status: 409,
    message: "Deactivate this category's active subcategories first",
  },
  CATEGORY_CONCURRENT_MODIFICATION: {
    status: 409,
    message: "The category tree was changed by another request; please retry",
  },
};

// Express needs the 4-argument signature to recognise an error handler.
export const errorHandler = (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ZodError) {
    return res.status(422).json({
      success: false,
      code: "VALIDATION_FAILED",
      message: "Validation failed",
      errors: error.issues,
    });
  }

  // Malformed JSON body (raised by express.json()).
  if (error instanceof SyntaxError && "type" in error && error.type === "entity.parse.failed") {
    return res.status(400).json({ success: false, code: "INVALID_JSON", message: "Malformed JSON body" });
  }

  if (error instanceof Error && error.message in errorResponses) {
    const { status, message } = errorResponses[error.message]!;
    return res.status(status).json({ success: false, code: error.message, message });
  }

  // Fallback for unique-constraint violations no service translated.
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return res.status(409).json({ success: false, code: "ALREADY_EXISTS", message: "Resource already exists" });
  }

  console.error("Unhandled error:", error);
  return res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
};

export const notFoundHandler = (_req: Request, res: Response) =>
  res.status(404).json({ success: false, code: "ROUTE_NOT_FOUND", message: "Route not found" });

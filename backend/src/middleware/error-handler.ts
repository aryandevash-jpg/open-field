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
  USER_NOT_FOUND: { status: 404, message: "No user with that email" },
  MEMBER_ALREADY_EXISTS: { status: 409, message: "That user is already a member" },
  INVALID_TEAM_MEMBERSHIP: {
    status: 422,
    message: "Team and membership must belong to the same active organization",
  },

  // Service areas
  SERVICE_AREA_INVALID: {
    status: 422,
    message: "Service area is not a valid shape (for example, its boundary crosses itself)",
  },

  // Events
  EVENT_NOT_FOUND: { status: 404, message: "Event not found" },
  EVENT_NOT_ACTIVE: { status: 409, message: "Event is not active" },
  EVENT_INVALID_DATES: { status: 422, message: "An event cannot end before it starts" },
  EVENT_HOST_CANNOT_PARTICIPATE: { status: 422, message: "The host organization already takes part in its event" },
  PARTICIPATION_NOT_FOUND: { status: 404, message: "Participation request not found" },
  PARTICIPATION_NOT_PENDING: { status: 409, message: "Participation request has already been reviewed" },

  // Reports
  REPORT_NOT_FOUND: { status: 404, message: "Report not found" },
  REPORT_INVALID_TRANSITION: { status: 409, message: "This action is not allowed in the report's current status" },
  DUPLICATE_TARGET_INVALID: { status: 422, message: "The canonical report does not exist or is this report" },

  // Assignments
  TEAM_NOT_AVAILABLE: { status: 422, message: "Team not found or not active" },
  REPORT_NOT_CLAIMABLE: { status: 409, message: "Only verified reports can be claimed" },
  REPORT_ALREADY_CLAIMED: { status: 409, message: "Another team is already working on this report" },
  ASSIGNMENT_NOT_FOUND: { status: 404, message: "Assignment not found" },
  ASSIGNMENT_INVALID_TRANSITION: { status: 409, message: "This action is not allowed in the assignment's current status" },
  ASSIGNMENT_EXPIRED: { status: 409, message: "The claim expired because work did not start before the deadline" },

  TRANSFER_SAME_TEAM: { status: 422, message: "Choose a different team to transfer to" },
  TEAM_NOT_ELIGIBLE: { status: 422, message: "That team's organization cannot take on this report" },

  // Collaboration
  COLLABORATION_NOT_FOUND: { status: 404, message: "Collaboration not found" },
  COLLABORATION_SELF: { status: 422, message: "The lead organization cannot invite itself" },
  COLLABORATION_NOT_PENDING: { status: 409, message: "This invitation has already been answered or the assignment ended" },
  COLLABORATION_NOT_ACCEPTED: { status: 409, message: "Accept the invitation before nominating teams" },
  ORGANIZATION_NOT_FOUND: { status: 404, message: "Organization not found" },

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

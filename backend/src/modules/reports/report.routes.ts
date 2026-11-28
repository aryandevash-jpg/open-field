import { Router } from "express";
import { requireAuth, requirePlatformAdmin } from "../../middleware/auth.js";
import { claimReport, getOpportunities, listReportAssignments } from "../assignments/assignment.controller.js";
import {
  addComment,
  createReport,
  getReport,
  getReportHistory,
  listComments,
  listReports,
  markDuplicate,
  rejectReport,
  reopenReport,
  requestInformation,
  resolveReport,
  returnToVerified,
  startReview,
  verifyReport,
} from "./report.controller.js";

const router = Router();

router.post("/", requireAuth, createReport);
router.get("/", requireAuth, listReports);
// Before "/:reportId" so "opportunities" is not read as an id.
router.get("/opportunities", requireAuth, getOpportunities);
router.get("/:reportId", requireAuth, getReport);
router.get("/:reportId/history", requireAuth, getReportHistory);
router.get("/:reportId/comments", requireAuth, listComments);
router.post("/:reportId/comments", requireAuth, addComment);

// Assignments: coordinators claim for one of their teams.
router.post("/:reportId/assignments/claim", requireAuth, claimReport);
router.get("/:reportId/assignments", requireAuth, listReportAssignments);

// Verification: platform admins act as verifiers in the MVP.
const verifier = [requireAuth, requirePlatformAdmin];
router.post("/:reportId/start-review", ...verifier, startReview);
router.post("/:reportId/verify", ...verifier, verifyReport);
router.post("/:reportId/reject", ...verifier, rejectReport);
router.post("/:reportId/request-information", ...verifier, requestInformation);
router.post("/:reportId/mark-duplicate", ...verifier, markDuplicate);
router.post("/:reportId/resolve", ...verifier, resolveReport);
router.post("/:reportId/return-to-verified", ...verifier, returnToVerified);
router.post("/:reportId/reopen", ...verifier, reopenReport);

export default router;

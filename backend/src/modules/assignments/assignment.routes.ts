import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import {
  cancelAssignment,
  completeAssignment,
  startAssignment,
  transferAssignment,
} from "./assignment.controller.js";
import { invite } from "../collaborations/collaboration.controller.js";

const router = Router();

router.post("/:assignmentId/start", requireAuth, startAssignment);
router.post("/:assignmentId/complete", requireAuth, completeAssignment);
router.post("/:assignmentId/cancel", requireAuth, cancelAssignment);
router.post("/:assignmentId/transfer", requireAuth, transferAssignment);
router.post("/:assignmentId/collaborations", requireAuth, invite);

export default router;

import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import {
  approveParticipation,
  completeEvent,
  createEvent,
  getEvent,
  getEventReports,
  listEvents,
  listParticipations,
  rejectParticipation,
  requestParticipation,
  updateEvent,
} from "./event.controller.js";

const router = Router();

router.get("/", requireAuth, listEvents);
router.post("/", requireAuth, createEvent);
router.get("/:eventId", requireAuth, getEvent);
router.patch("/:eventId", requireAuth, updateEvent);
router.post("/:eventId/complete", requireAuth, completeEvent);

router.post("/:eventId/participation-requests", requireAuth, requestParticipation);
router.get("/:eventId/participations", requireAuth, listParticipations);
router.post("/:eventId/participations/:organizationId/approve", requireAuth, approveParticipation);
router.post("/:eventId/participations/:organizationId/reject", requireAuth, rejectParticipation);

router.get("/:eventId/reports", requireAuth, getEventReports);

export default router;

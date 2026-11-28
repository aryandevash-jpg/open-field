import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { accept, decline, list, nominateTeam } from "./collaboration.controller.js";

const router = Router();

router.get("/", requireAuth, list);
router.post("/:collaborationId/accept", requireAuth, accept);
router.post("/:collaborationId/decline", requireAuth, decline);
router.post("/:collaborationId/teams", requireAuth, nominateTeam);

export default router;

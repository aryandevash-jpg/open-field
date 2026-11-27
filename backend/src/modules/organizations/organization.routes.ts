import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { addMember, addTeamMember, createOrganization, createTeam } from "./organization.controller.js";

const router = Router();

router.post("/", requireAuth, createOrganization);
router.post("/:organizationId/members", requireAuth, addMember);
router.post("/:organizationId/teams", requireAuth, createTeam);
router.post("/:organizationId/teams/:teamId/members", requireAuth, addTeamMember);

export default router;

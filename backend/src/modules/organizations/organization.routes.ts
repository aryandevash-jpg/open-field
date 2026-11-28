import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import {
  addCategoryCapability,
  addMember,
  addTeamMember,
  createOrganization,
  createServiceArea,
  createTeam,
  listCategoryCapabilities,
  listServiceAreas,
  removeCategoryCapability,
  removeServiceArea,
} from "./organization.controller.js";

const router = Router();

router.post("/", requireAuth, createOrganization);
router.post("/:organizationId/members", requireAuth, addMember);
router.post("/:organizationId/teams", requireAuth, createTeam);
router.post("/:organizationId/teams/:teamId/members", requireAuth, addTeamMember);

// Category capabilities (PUT/DELETE are idempotent)
router.get("/:organizationId/categories", requireAuth, listCategoryCapabilities);
router.put("/:organizationId/categories/:categoryId", requireAuth, addCategoryCapability);
router.delete("/:organizationId/categories/:categoryId", requireAuth, removeCategoryCapability);

// Service areas (DELETE is soft and idempotent)
router.get("/:organizationId/service-areas", requireAuth, listServiceAreas);
router.post("/:organizationId/service-areas", requireAuth, createServiceArea);
router.delete("/:organizationId/service-areas/:areaId", requireAuth, removeServiceArea);

export default router;

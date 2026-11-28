import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import {
  addCategoryCapability,
  addMember,
  addTeamMember,
  createOrganization,
  createServiceArea,
  createTeam,
  getOrganization,
  listAssignments,
  listCategoryCapabilities,
  listMyOrganizations,
  listOtherOrganizations,
  listServiceAreas,
  removeCategoryCapability,
  removeServiceArea,
} from "./organization.controller.js";

const router = Router();

router.get("/", requireAuth, listMyOrganizations);
router.post("/", requireAuth, createOrganization);
router.get("/:organizationId", requireAuth, getOrganization);
router.get("/:organizationId/assignments", requireAuth, listAssignments);
router.get("/:organizationId/other-organizations", requireAuth, listOtherOrganizations);
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

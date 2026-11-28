import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/auth.js";
import {
  addMemberSchema,
  addTeamMemberSchema,
  categoryCapabilityParamsSchema,
  createOrganizationSchema,
  createServiceAreaSchema,
  createTeamSchema,
  organizationParamsSchema,
  serviceAreaParamsSchema,
  teamParamsSchema,
} from "./organization.schema.js";
import * as organizationService from "./organization.service.js";

// Validation (ZodError) and service errors propagate to the central error
// handler in src/middleware/error-handler.ts.

export const createOrganization = async (req: AuthenticatedRequest, res: Response) => {
  const data = createOrganizationSchema.parse(req.body);
  const organization = await organizationService.createOrganization(req.auth!.userId, data);
  res.status(201).json({ success: true, data: organization });
};

export const addMember = async (req: AuthenticatedRequest, res: Response) => {
  const { organizationId } = organizationParamsSchema.parse(req.params);
  const data = addMemberSchema.parse(req.body);
  await organizationService.requireOrganizationManager(req.auth!.userId, organizationId);
  const membership = await organizationService.addMember(organizationId, data);
  res.status(201).json({ success: true, data: membership });
};

export const createTeam = async (req: AuthenticatedRequest, res: Response) => {
  const { organizationId } = organizationParamsSchema.parse(req.params);
  const { name } = createTeamSchema.parse(req.body);
  await organizationService.requireOrganizationManager(req.auth!.userId, organizationId);
  const team = await organizationService.createTeam(organizationId, req.auth!.userId, name);
  res.status(201).json({ success: true, data: team });
};

export const addTeamMember = async (req: AuthenticatedRequest, res: Response) => {
  const { organizationId, teamId } = teamParamsSchema.parse(req.params);
  const data = addTeamMemberSchema.parse(req.body);
  await organizationService.requireOrganizationManager(req.auth!.userId, organizationId);
  const teamMembership = await organizationService.addTeamMember(organizationId, teamId, data);
  res.status(201).json({ success: true, data: teamMembership });
};

export const listCategoryCapabilities = async (req: AuthenticatedRequest, res: Response) => {
  const { organizationId } = organizationParamsSchema.parse(req.params);
  await organizationService.requireOrganizationMember(req.auth!.userId, organizationId);
  const capabilities = await organizationService.listCategoryCapabilities(organizationId);
  res.status(200).json({ success: true, data: capabilities });
};

export const addCategoryCapability = async (req: AuthenticatedRequest, res: Response) => {
  const { organizationId, categoryId } = categoryCapabilityParamsSchema.parse(req.params);
  await organizationService.requireOrganizationManager(req.auth!.userId, organizationId);
  const capability = await organizationService.addCategoryCapability(organizationId, categoryId);
  res.status(200).json({ success: true, data: capability });
};

export const removeCategoryCapability = async (req: AuthenticatedRequest, res: Response) => {
  const { organizationId, categoryId } = categoryCapabilityParamsSchema.parse(req.params);
  await organizationService.requireOrganizationManager(req.auth!.userId, organizationId);
  await organizationService.removeCategoryCapability(organizationId, categoryId);
  res.status(204).send();
};

export const listServiceAreas = async (req: AuthenticatedRequest, res: Response) => {
  const { organizationId } = organizationParamsSchema.parse(req.params);
  await organizationService.requireOrganizationMember(req.auth!.userId, organizationId);
  const areas = await organizationService.listServiceAreas(organizationId);
  res.status(200).json({ success: true, data: areas });
};

export const createServiceArea = async (req: AuthenticatedRequest, res: Response) => {
  const { organizationId } = organizationParamsSchema.parse(req.params);
  const data = createServiceAreaSchema.parse(req.body);
  await organizationService.requireOrganizationManager(req.auth!.userId, organizationId);
  const area = await organizationService.createServiceArea(organizationId, data);
  res.status(201).json({ success: true, data: area });
};

export const removeServiceArea = async (req: AuthenticatedRequest, res: Response) => {
  const { organizationId, areaId } = serviceAreaParamsSchema.parse(req.params);
  await organizationService.requireOrganizationManager(req.auth!.userId, organizationId);
  await organizationService.removeServiceArea(organizationId, areaId);
  res.status(204).send();
};

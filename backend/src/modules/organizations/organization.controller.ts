import type { Response } from "express";
import { Prisma } from "../../generated/prisma/client.js";
import type { AuthenticatedRequest } from "../../middleware/auth.js";
import { addMemberSchema, addTeamMemberSchema, createOrganizationSchema, createTeamSchema } from "./organization.schema.js";
import * as organizationService from "./organization.service.js";

const validationError = (res: Response, issues: unknown) =>
  res.status(422).json({ success: false, message: "Validation failed", errors: issues });

const requiredParam = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

const handleError = (res: Response, error: unknown) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return res.status(409).json({ success: false, message: "This relationship already exists" });
  }
  if (error instanceof Error && error.message === "FORBIDDEN") {
    return res.status(403).json({ success: false, message: "Insufficient organization permissions" });
  }
  if (error instanceof Error && error.message === "INVALID_TEAM_MEMBERSHIP") {
    return res.status(422).json({ success: false, message: "Team and membership must belong to the same active organization" });
  }
  console.error("Organization operation failed:", error);
  return res.status(500).json({ success: false, message: "Internal server error" });
};

export const createOrganization = async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createOrganizationSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.issues);
  try {
    const organization = await organizationService.createOrganization(req.auth!.userId, parsed.data);
    return res.status(201).json({ success: true, data: organization });
  } catch (error) { return handleError(res, error); }
};

export const addMember = async (req: AuthenticatedRequest, res: Response) => {
  const parsed = addMemberSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.issues);
  const organizationId = requiredParam(req.params.organizationId);
  if (!organizationId) return res.status(400).json({ success: false, message: "Invalid organization ID" });
  try {
    await organizationService.requireOrganizationManager(req.auth!.userId, organizationId);
    const membership = await organizationService.addMember(organizationId, parsed.data);
    return res.status(201).json({ success: true, data: membership });
  } catch (error) { return handleError(res, error); }
};

export const createTeam = async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createTeamSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.issues);
  const organizationId = requiredParam(req.params.organizationId);
  if (!organizationId) return res.status(400).json({ success: false, message: "Invalid organization ID" });
  try {
    await organizationService.requireOrganizationManager(req.auth!.userId, organizationId);
    const team = await organizationService.createTeam(organizationId, req.auth!.userId, parsed.data.name);
    return res.status(201).json({ success: true, data: team });
  } catch (error) { return handleError(res, error); }
};

export const addTeamMember = async (req: AuthenticatedRequest, res: Response) => {
  const parsed = addTeamMemberSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.issues);
  const organizationId = requiredParam(req.params.organizationId);
  const teamId = requiredParam(req.params.teamId);
  if (!organizationId || !teamId) return res.status(400).json({ success: false, message: "Invalid organization or team ID" });
  try {
    await organizationService.requireOrganizationManager(req.auth!.userId, organizationId);
    const teamMembership = await organizationService.addTeamMember(organizationId, teamId, parsed.data);
    return res.status(201).json({ success: true, data: teamMembership });
  } catch (error) { return handleError(res, error); }
};

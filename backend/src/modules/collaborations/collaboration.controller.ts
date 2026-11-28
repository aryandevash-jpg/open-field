import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../middleware/auth.js";
import * as collaborationService from "./collaboration.service.js";

const assignmentParams = z.object({ assignmentId: z.uuid() });
const collaborationParams = z.object({ collaborationId: z.uuid() });
const inviteSchema = z.object({ organizationId: z.uuid() });
const nominateSchema = z.object({ teamId: z.uuid() });
const listSchema = z.object({ organizationId: z.uuid() });

export const invite = async (req: AuthenticatedRequest, res: Response) => {
  const { assignmentId } = assignmentParams.parse(req.params);
  const { organizationId } = inviteSchema.parse(req.body);
  const collaboration = await collaborationService.inviteOrganization(req.auth!.userId, assignmentId, organizationId);
  res.status(200).json({ success: true, data: collaboration });
};

const respond = (accept: boolean) => async (req: AuthenticatedRequest, res: Response) => {
  const { collaborationId } = collaborationParams.parse(req.params);
  const collaboration = await collaborationService.respondToInvitation(req.auth!.userId, collaborationId, accept);
  res.status(200).json({ success: true, data: collaboration });
};

export const accept = respond(true);
export const decline = respond(false);

export const nominateTeam = async (req: AuthenticatedRequest, res: Response) => {
  const { collaborationId } = collaborationParams.parse(req.params);
  const { teamId } = nominateSchema.parse(req.body);
  const collaboration = await collaborationService.nominateTeam(req.auth!.userId, collaborationId, teamId);
  res.status(200).json({ success: true, data: collaboration });
};

export const list = async (req: AuthenticatedRequest, res: Response) => {
  const { organizationId } = listSchema.parse(req.query);
  const items = await collaborationService.listOrganizationCollaborations(req.auth!.userId, organizationId);
  res.status(200).json({ success: true, data: items });
};

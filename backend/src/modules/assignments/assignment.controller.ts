import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/auth.js";
import { requireOrganizationMember } from "../organizations/organization.service.js";
import { reportParamsSchema } from "../reports/report.schema.js";
import { assertCanViewReport, listOpportunities } from "../reports/report.service.js";
import {
  assignmentParamsSchema,
  claimSchema,
  completeAssignmentSchema,
  opportunitiesQuerySchema,
  transferSchema,
} from "./assignment.schema.js";
import * as assignmentService from "./assignment.service.js";

// Errors propagate to the central error handler.

export const getOpportunities = async (req: AuthenticatedRequest, res: Response) => {
  const { organizationId } = opportunitiesQuerySchema.parse(req.query);
  await requireOrganizationMember(req.auth!.userId, organizationId);
  res.status(200).json({ success: true, data: await listOpportunities(organizationId) });
};

export const claimReport = async (req: AuthenticatedRequest, res: Response) => {
  const { reportId } = reportParamsSchema.parse(req.params);
  const { teamId } = claimSchema.parse(req.body);
  const assignment = await assignmentService.claimReport(req.auth!.userId, reportId, teamId);
  res.status(201).json({ success: true, data: assignment });
};

export const listReportAssignments = async (req: AuthenticatedRequest, res: Response) => {
  const { reportId } = reportParamsSchema.parse(req.params);
  await assertCanViewReport(req.auth!.userId, reportId);
  res.status(200).json({ success: true, data: await assignmentService.listReportAssignments(reportId) });
};

export const startAssignment = async (req: AuthenticatedRequest, res: Response) => {
  const { assignmentId } = assignmentParamsSchema.parse(req.params);
  res.status(200).json({ success: true, data: await assignmentService.startAssignment(req.auth!.userId, assignmentId) });
};

export const completeAssignment = async (req: AuthenticatedRequest, res: Response) => {
  const { assignmentId } = assignmentParamsSchema.parse(req.params);
  const evidence = completeAssignmentSchema.parse(req.body ?? {});
  const assignment = await assignmentService.completeAssignment(req.auth!.userId, assignmentId, evidence);
  res.status(200).json({ success: true, data: assignment });
};

export const cancelAssignment = async (req: AuthenticatedRequest, res: Response) => {
  const { assignmentId } = assignmentParamsSchema.parse(req.params);
  res.status(200).json({ success: true, data: await assignmentService.cancelAssignment(req.auth!.userId, assignmentId) });
};

export const transferAssignment = async (req: AuthenticatedRequest, res: Response) => {
  const { assignmentId } = assignmentParamsSchema.parse(req.params);
  const { teamId } = transferSchema.parse(req.body);
  const assignment = await assignmentService.transferAssignment(req.auth!.userId, assignmentId, teamId);
  res.status(201).json({ success: true, data: assignment });
};

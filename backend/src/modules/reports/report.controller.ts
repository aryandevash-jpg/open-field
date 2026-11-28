import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/auth.js";
import {
  commentSchema,
  createReportSchema,
  listReportsSchema,
  markDuplicateSchema,
  optionalReasonSchema,
  reportParamsSchema,
  requiredReasonSchema,
} from "./report.schema.js";
import * as reportService from "./report.service.js";

// Errors propagate to the central error handler.

export const createReport = async (req: AuthenticatedRequest, res: Response) => {
  const data = createReportSchema.parse(req.body);
  res.status(201).json({ success: true, data: await reportService.createReport(req.auth!.userId, data) });
};

export const listReports = async (req: AuthenticatedRequest, res: Response) => {
  const filter = listReportsSchema.parse(req.query);
  res.status(200).json({ success: true, data: await reportService.listReports(req.auth!.userId, filter) });
};

export const getReport = async (req: AuthenticatedRequest, res: Response) => {
  const { reportId } = reportParamsSchema.parse(req.params);
  res.status(200).json({ success: true, data: await reportService.getReportForUser(req.auth!.userId, reportId) });
};

export const getReportHistory = async (req: AuthenticatedRequest, res: Response) => {
  const { reportId } = reportParamsSchema.parse(req.params);
  res.status(200).json({ success: true, data: await reportService.getReportHistory(req.auth!.userId, reportId) });
};

// Verification commands (platform admins only; enforced in the routes).

const command =
  (name: reportService.ReportCommand, bodySchema: typeof optionalReasonSchema | typeof requiredReasonSchema) =>
  async (req: AuthenticatedRequest, res: Response) => {
    const { reportId } = reportParamsSchema.parse(req.params);
    const { reason } = bodySchema.parse(req.body ?? {});
    const report = await reportService.transitionReport(reportId, req.auth!.userId, name, { reason });
    res.status(200).json({ success: true, data: report });
  };

export const startReview = command("START_REVIEW", optionalReasonSchema);
export const verifyReport = command("VERIFY", optionalReasonSchema);
export const rejectReport = command("REJECT", requiredReasonSchema);
export const requestInformation = command("REQUEST_INFORMATION", requiredReasonSchema);
export const resolveReport = command("RESOLVE", optionalReasonSchema);
export const returnToVerified = command("RETURN_TO_VERIFIED", requiredReasonSchema);
export const reopenReport = command("REOPEN", requiredReasonSchema);

export const markDuplicate = async (req: AuthenticatedRequest, res: Response) => {
  const { reportId } = reportParamsSchema.parse(req.params);
  const { duplicateOfReportId, reason } = markDuplicateSchema.parse(req.body);
  const report = await reportService.transitionReport(reportId, req.auth!.userId, "MARK_DUPLICATE", {
    reason,
    duplicateOfReportId,
  });
  res.status(200).json({ success: true, data: report });
};

export const listComments = async (req: AuthenticatedRequest, res: Response) => {
  const { reportId } = reportParamsSchema.parse(req.params);
  res.status(200).json({ success: true, data: await reportService.listComments(req.auth!.userId, reportId) });
};

export const addComment = async (req: AuthenticatedRequest, res: Response) => {
  const { reportId } = reportParamsSchema.parse(req.params);
  const { body } = commentSchema.parse(req.body);
  res.status(201).json({ success: true, data: await reportService.addComment(req.auth!.userId, reportId, body) });
};

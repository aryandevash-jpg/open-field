import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/auth.js";
import { requireOrganizationManager, requireOrganizationMember } from "../organizations/organization.service.js";
import { listEventReports } from "../reports/report.service.js";
import {
  createEventSchema,
  eventParamsSchema,
  participationParamsSchema,
  participationRequestSchema,
  updateEventSchema,
} from "./event.schema.js";
import * as eventService from "./event.service.js";

// Errors propagate to the central error handler.

export const listEvents = async (_req: AuthenticatedRequest, res: Response) => {
  res.status(200).json({ success: true, data: await eventService.listActiveEvents() });
};

export const getEvent = async (req: AuthenticatedRequest, res: Response) => {
  const { eventId } = eventParamsSchema.parse(req.params);
  res.status(200).json({ success: true, data: await eventService.getEvent(eventId) });
};

export const createEvent = async (req: AuthenticatedRequest, res: Response) => {
  const data = createEventSchema.parse(req.body);
  await requireOrganizationManager(req.auth!.userId, data.organizationId);
  const event = await eventService.createEvent(req.auth!.userId, data);
  res.status(201).json({ success: true, data: event });
};

export const updateEvent = async (req: AuthenticatedRequest, res: Response) => {
  const { eventId } = eventParamsSchema.parse(req.params);
  const data = updateEventSchema.parse(req.body);
  await requireOrganizationManager(req.auth!.userId, await eventService.getEventHostId(eventId));
  res.status(200).json({ success: true, data: await eventService.updateEvent(eventId, data) });
};

export const completeEvent = async (req: AuthenticatedRequest, res: Response) => {
  const { eventId } = eventParamsSchema.parse(req.params);
  await requireOrganizationManager(req.auth!.userId, await eventService.getEventHostId(eventId));
  res.status(200).json({ success: true, data: await eventService.completeEvent(eventId) });
};

export const requestParticipation = async (req: AuthenticatedRequest, res: Response) => {
  const { eventId } = eventParamsSchema.parse(req.params);
  const { organizationId } = participationRequestSchema.parse(req.body);
  await requireOrganizationManager(req.auth!.userId, organizationId);
  const participation = await eventService.requestParticipation(eventId, organizationId);
  res.status(200).json({ success: true, data: participation });
};

export const listParticipations = async (req: AuthenticatedRequest, res: Response) => {
  const { eventId } = eventParamsSchema.parse(req.params);
  await requireOrganizationMember(req.auth!.userId, await eventService.getEventHostId(eventId));
  res.status(200).json({ success: true, data: await eventService.listParticipations(eventId) });
};

const review = (decision: "APPROVED" | "REJECTED") => async (req: AuthenticatedRequest, res: Response) => {
  const { eventId, organizationId } = participationParamsSchema.parse(req.params);
  await requireOrganizationManager(req.auth!.userId, await eventService.getEventHostId(eventId));
  const participation = await eventService.reviewParticipation(eventId, organizationId, req.auth!.userId, decision);
  res.status(200).json({ success: true, data: participation });
};

export const approveParticipation = review("APPROVED");
export const rejectParticipation = review("REJECTED");

export const getEventReports = async (req: AuthenticatedRequest, res: Response) => {
  const { eventId } = eventParamsSchema.parse(req.params);
  await eventService.getEvent(eventId); // 404 for unknown events
  res.status(200).json({ success: true, data: await listEventReports(req.auth!.userId, eventId) });
};

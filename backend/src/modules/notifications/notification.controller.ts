import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../middleware/auth.js";
import * as notificationService from "./notification.service.js";

const listSchema = z.object({
  unreadOnly: z.enum(["true", "false"]).default("false"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const paramsSchema = z.object({ notificationId: z.uuid() });

export const listNotifications = async (req: AuthenticatedRequest, res: Response) => {
  const query = listSchema.parse(req.query);
  const userId = req.auth!.userId;
  const [items, unread] = await Promise.all([
    notificationService.listNotifications(userId, { unreadOnly: query.unreadOnly === "true", limit: query.limit }),
    notificationService.countUnread(userId),
  ]);
  res.status(200).json({ success: true, data: { items, unread } });
};

export const markRead = async (req: AuthenticatedRequest, res: Response) => {
  const { notificationId } = paramsSchema.parse(req.params);
  await notificationService.markRead(req.auth!.userId, notificationId);
  res.status(204).send();
};

export const markAllRead = async (req: AuthenticatedRequest, res: Response) => {
  await notificationService.markAllRead(req.auth!.userId);
  res.status(204).send();
};

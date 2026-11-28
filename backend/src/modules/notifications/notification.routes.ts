import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { listNotifications, markAllRead, markRead } from "./notification.controller.js";

const router = Router();

router.get("/", requireAuth, listNotifications);
router.post("/read-all", requireAuth, markAllRead);
router.post("/:notificationId/read", requireAuth, markRead);

export default router;

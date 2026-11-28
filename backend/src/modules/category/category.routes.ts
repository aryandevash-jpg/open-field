import { Router } from "express";
import { requireAuth, requirePlatformAdmin } from "../../middleware/auth.js";
import {
  createCategory,
  getCategory,
  listCategories,
  setCategoryStatus,
  updateCategory,
} from "./category.controller.js";

const router = Router();

// Any signed-in user can browse the shared taxonomy (reporters pick from it).
router.get("/", requireAuth, listCategories);
router.get("/:id", requireAuth, getCategory);

// Only platform admins change it.
router.post("/", requireAuth, requirePlatformAdmin, createCategory);
router.patch("/:id", requireAuth, requirePlatformAdmin, updateCategory);
router.patch("/:id/status", requireAuth, requirePlatformAdmin, setCategoryStatus);

export default router;

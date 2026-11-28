import type { Request, Response } from "express";
import {
  categoryParamsSchema,
  createCategorySchema,
  listCategoriesSchema,
  setCategoryStatusSchema,
  updateCategorySchema,
} from "./category.schema.js";
import * as categoryService from "./category.service.js";

// Validation (ZodError) and service errors propagate to the central error
// handler in src/middleware/error-handler.ts. Hierarchy rules are enforced by
// PostgreSQL; the service translates its rejections into error codes.

export const listCategories = async (req: Request, res: Response) => {
  const query = listCategoriesSchema.parse(req.query);
  const categories = await categoryService.listCategories({
    search: query.search,
    includeInactive: query.includeInactive === "true",
    rootsOnly: query.rootsOnly === "true",
  });
  res.status(200).json({ success: true, data: categories });
};

export const getCategory = async (req: Request, res: Response) => {
  const { id } = categoryParamsSchema.parse(req.params);
  const category = await categoryService.getCategoryById(id);
  res.status(200).json({ success: true, data: category });
};

export const createCategory = async (req: Request, res: Response) => {
  const data = createCategorySchema.parse(req.body);
  const category = await categoryService.createCategory(data);
  res.status(201).json({ success: true, data: category });
};

export const updateCategory = async (req: Request, res: Response) => {
  const { id } = categoryParamsSchema.parse(req.params);
  const data = updateCategorySchema.parse(req.body);
  const category = await categoryService.updateCategory(id, data);
  res.status(200).json({ success: true, data: category });
};

export const setCategoryStatus = async (req: Request, res: Response) => {
  const { id } = categoryParamsSchema.parse(req.params);
  const { isActive } = setCategoryStatusSchema.parse(req.body);
  const category = await categoryService.setCategoryActive(id, isActive);
  res.status(200).json({ success: true, data: category });
};

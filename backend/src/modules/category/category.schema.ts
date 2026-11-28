import { z } from "zod";

export const createCategorySchema = z.object({
  name: z.string().trim().min(2).max(80),

  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message: "Invalid category slug",
    }),

  description: z.string().trim().max(500).nullable().optional(),

  parentId: z.string().uuid().nullable().optional(),
});

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),

    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),

    description: z.string().trim().max(500).nullable().optional(),

    parentId: z.string().uuid().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export const categoryParamsSchema = z.object({
  id: z.string().uuid(),
});

export const listCategoriesSchema = z.object({
  search: z.string().trim().optional(),
  includeInactive: z.enum(["true", "false"]).optional(),
  rootsOnly: z.enum(["true", "false"]).optional(),
});

export type CreateCategoryInput = z.infer<
  typeof createCategorySchema
>;

export type UpdateCategoryInput = z.infer<
  typeof updateCategorySchema
>;

export const setCategoryStatusSchema = z.object({
  isActive: z.boolean(),
});

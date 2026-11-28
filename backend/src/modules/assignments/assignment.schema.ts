import { z } from "zod";
import { MAX_MEDIA_PER_REPORT } from "../reports/report.schema.js";

export const claimSchema = z.object({ teamId: z.uuid() });

export const assignmentParamsSchema = z.object({ assignmentId: z.uuid() });

// Completion evidence: a note and/or photo URLs (stored as report media).
export const completeAssignmentSchema = z.object({
  note: z.string().trim().min(3).max(2_000).optional(),
  media: z
    .array(z.object({ url: z.url({ protocol: /^https?$/ }).max(2_048), contentType: z.string().trim().max(100).optional() }))
    .max(MAX_MEDIA_PER_REPORT)
    .default([]),
});

export const opportunitiesQuerySchema = z.object({ organizationId: z.uuid() });

export const transferSchema = z.object({ teamId: z.uuid() });

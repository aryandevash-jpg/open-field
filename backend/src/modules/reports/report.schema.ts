import { z } from "zod";
import { ReportStatus } from "../../generated/prisma/client.js";

export const MAX_MEDIA_PER_REPORT = 10;

export const createReportSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(1).max(5_000),
  categoryId: z.uuid(),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  eventId: z.uuid().optional(),
  // MVP: the client uploads elsewhere and sends the resulting URL.
  media: z
    .array(
      z.object({
        url: z.url({ protocol: /^https?$/ }).max(2_048),
        contentType: z.string().trim().max(100).optional(),
      })
    )
    .max(MAX_MEDIA_PER_REPORT)
    .default([]),
});

export const reportParamsSchema = z.object({ reportId: z.uuid() });

export const listReportsSchema = z.object({
  status: z.enum(ReportStatus).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const optionalReasonSchema = z.object({ reason: z.string().trim().min(3).max(1_000).optional() });

// Rejecting or sending a report back to the reporter must say why.
export const requiredReasonSchema = z.object({ reason: z.string().trim().min(3).max(1_000) });

export const markDuplicateSchema = z.object({
  duplicateOfReportId: z.uuid(),
  reason: z.string().trim().min(3).max(1_000).optional(),
});

export const commentSchema = z.object({ body: z.string().trim().min(1).max(2_000) });

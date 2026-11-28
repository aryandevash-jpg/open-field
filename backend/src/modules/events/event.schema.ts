import { z } from "zod";

export const createEventSchema = z
  .object({
    organizationId: z.uuid(),
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().max(2_000).optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().optional(),
  })
  .refine((event) => !event.endsAt || event.endsAt >= event.startsAt, {
    message: "endsAt must not be before startsAt",
    path: ["endsAt"],
  });

// Details only. Status changes go through POST /events/:eventId/complete.
// Dates are checked against each other by the database (Event_dates_check),
// because a partial update may only send one of them.
export const updateEventSchema = z
  .object({
    title: z.string().trim().min(3).max(160).optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "At least one field must be provided" });

export const eventParamsSchema = z.object({ eventId: z.uuid() });

export const participationParamsSchema = z.object({
  eventId: z.uuid(),
  organizationId: z.uuid(),
});

export const participationRequestSchema = z.object({ organizationId: z.uuid() });

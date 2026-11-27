import { z } from "zod";

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1_000).optional(),
});

export const addMemberSchema = z.object({
  userId: z.uuid(),
  role: z.enum(["ADMIN", "COORDINATOR", "MEMBER"]).default("MEMBER"),
});

export const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(120),
});

export const addTeamMemberSchema = z.object({
  membershipId: z.uuid(),
  isLeader: z.boolean().default(false),
});

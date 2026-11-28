import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";

export interface AuthenticatedRequest extends Request {
  auth?: { userId: string };
}

export const requireAuth = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

  if (!token) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (typeof payload !== "object" || typeof payload.userId !== "string") {
      return res.status(401).json({ success: false, message: "Invalid access token" });
    }
    req.auth = { userId: payload.userId };
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid access token" });
  }
};

// Use after requireAuth. Re-reads the flag on every request so revoking admin
// rights takes effect immediately, not when the token expires.
export const requirePlatformAdmin = async (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
) => {
  const user = await prisma.user.findUnique({
    where: { id: req.auth!.userId },
    select: { isPlatformAdmin: true },
  });
  if (!user?.isPlatformAdmin) throw new Error("FORBIDDEN");
  next();
};

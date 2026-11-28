import type { Request, Response } from "express";
import { loginSchema, registerSchema } from "./auth.schema.js";
import { loginUser, registerUser } from "./auth.service.js";

// Validation (ZodError) and service errors propagate to the central error
// handler in src/middleware/error-handler.ts.

export const register = async (req: Request, res: Response) => {
  const data = registerSchema.parse(req.body);
  const user = await registerUser(data);
  res.status(201).json({ success: true, message: "User registered successfully", data: user });
};

export const login = async (req: Request, res: Response) => {
  const { email, password } = loginSchema.parse(req.body);
  const result = await loginUser(email, password);
  res.status(200).json({ success: true, message: "Login successful", data: result });
};

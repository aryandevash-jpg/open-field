
import dotenv from "dotenv";

dotenv.config();

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not defined");
}

const adapter = new PrismaPg({ connectionString });

// Interactive transactions that lock a row (claims, verification) can queue
// behind each other, and Neon adds network latency to every statement. Prisma's
// defaults (2 s to start, 5 s total) are too tight for that and surfaced as
// P2028 under concurrent claims.
export const prisma = new PrismaClient({
  adapter,
  transactionOptions: { maxWait: 10_000, timeout: 20_000 },
});

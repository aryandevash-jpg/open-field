import "dotenv/config";

export const env = {
  PORT: process.env.PORT || 5050,
  DATABASE_URL: process.env.DATABASE_URL!,
  JWT_SECRET: process.env.JWT_SECRET!,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d",
};

if (!env.JWT_SECRET || !env.DATABASE_URL) {
  throw new Error("Missing required environment variables");
}
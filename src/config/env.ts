import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(5000),
  DATABASE_URL: z.string().optional(), // becomes required in commit 2
  JWT_SECRET: z.string().min(10, "JWT_SECRET must be at least 10 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error(
    "❌ Invalid environment variables:",
    z.flattenError(result.error).fieldErrors,
  );
  process.exit(1);
}

export const env = result.data;

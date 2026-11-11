import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "./env.js";

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({
    adapter,
    transactionOptions: {
        maxWait: 10000, // wait up to 10s to get a connection
        timeout: 15000, // a transaction may run up to 15s
    },
});

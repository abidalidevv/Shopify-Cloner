// db.ts — the single Prisma client. Everything imports it from here (scheduler.ts re-exports it for older imports).
import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();

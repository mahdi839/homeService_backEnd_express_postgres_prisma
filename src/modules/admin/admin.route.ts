import { Router } from "express";
import { z } from "zod";
import { auth } from "../../middlewares/auth.js";
import { validate } from "../../middlewares/validate.js";
import { prisma } from "../../config/prisma.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { ApiError } from "../../utils/ApiError.js";
import type { Prisma } from "../../generated/prisma/client.js";

const router = Router();

// Every route in this file: admin only
router.use(auth("ADMIN"));

const listUsersQuery = z.object({
  role: z.enum(["CUSTOMER", "TECHNICIAN", "ADMIN"]).optional(),
  status: z.enum(["ACTIVE", "BANNED"]).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

// GET /api/admin/users → all users with filters
router.get("/users", async (req, res) => {
  const { role, status, search, page, limit } = listUsersQuery.parse(req.query);

  const where: Prisma.UserWhereInput = {
    role,
    status,
    ...(search && {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ],
    }),
  };

  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      omit: { password: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  sendResponse(res, {
    statusCode: 200,
    message: "Users fetched",
    data: users,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

const updateUserStatusSchema = z.object({
  status: z.enum(["ACTIVE", "BANNED"]),
});

// PATCH /api/admin/users/:id → ban / unban
router.patch("/users/:id", validate(updateUserStatusSchema), async (req, res) => {
  const userId = req.params.id as string;
  const { status } = req.body as z.infer<typeof updateUserStatusSchema>;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // Admins can't be banned (this also stops an admin banning themselves)
  if (user.role === "ADMIN") {
    throw new ApiError(400, "Admin accounts cannot be banned");
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { status },
    omit: { password: true },
  });

  sendResponse(res, {
    statusCode: 200,
    message: status === "BANNED" ? "User banned" : "User unbanned",
    data: updated,
  });
});

export default router;

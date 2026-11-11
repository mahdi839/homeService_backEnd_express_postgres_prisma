import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { ApiError } from "../../utils/ApiError.js";
import type { Prisma } from "../../generated/prisma/client.js";

const router = Router();

const listQuerySchema = z.object({
  search: z.string().optional(),
  categoryId: z.string().optional(),
  location: z.string().optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

// GET /api/technicians → public list with filters + pagination
router.get("/", async (req, res) => {
  const { search, categoryId, location, minRating, page, limit } = listQuerySchema.parse(req.query);

  // Build the filter step by step: only add a condition if that filter was sent
  const where: Prisma.TechnicianProfileWhereInput = {
    isAvailable: true,
    user: { status: "ACTIVE" },
    ...(location && { location: { contains: location, mode: "insensitive" } }),
    ...(minRating !== undefined && { avgRating: { gte: minRating } }),
    ...(categoryId && { services: { some: { categoryId, isActive: true } } }),
    ...(search && {
      OR: [
        { user: { name: { contains: search, mode: "insensitive" } } },
        { bio: { contains: search, mode: "insensitive" } },
      ],
    }),
  };

  const [technicians, total] = await prisma.$transaction([
    prisma.technicianProfile.findMany({
      where,
      include: {
        user: { select: { id: true, name: true } },
        services: { where: { isActive: true }, include: { category: true } },
      },
      orderBy: { avgRating: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.technicianProfile.count({ where }),
  ]);

  sendResponse(res, {
    statusCode: 200,
    message: "Technicians fetched",
    data: technicians,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

// GET /api/technicians/:id → one technician's public profile
router.get("/:id", async (req, res) => {
  const id = req.params.id as string;

  const technician = await prisma.technicianProfile.findFirst({
    where: { id, user: { status: "ACTIVE" } },
    include: {
      user: { select: { id: true, name: true } },
      services: { where: { isActive: true }, include: { category: true } },
      availabilitySlots: { orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] },
    },
  });

  if (!technician) {
    throw new ApiError(404, "Technician not found");
  }

  sendResponse(res, { statusCode: 200, message: "Technician fetched", data: technician });
});

export default router;

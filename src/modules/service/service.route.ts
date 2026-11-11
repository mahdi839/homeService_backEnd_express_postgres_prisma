import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { sendResponse } from "../../utils/sendResponse.js";
import type { Prisma } from "../../generated/prisma/client.js";

const router = Router();

const serviceQuerySchema = z
  .object({
    search: z.string().optional(),
    categoryId: z.string().optional(),
    location: z.string().optional(),
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    sort: z.enum(["price_asc", "price_desc", "newest"]).default("newest"),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .refine((q) => q.minPrice === undefined || q.maxPrice === undefined || q.minPrice <= q.maxPrice, {
    message: "minPrice must be less than or equal to maxPrice",
    path: ["minPrice"],
  });

// Map the "sort" text to a Prisma orderBy
const sortOptions: Record<string, Prisma.ServiceOrderByWithRelationInput> = {
  price_asc: { price: "asc" },
  price_desc: { price: "desc" },
  newest: { createdAt: "desc" },
};

// GET /api/services → public service search
router.get("/", async (req, res) => {
  const { search, categoryId, location, minPrice, maxPrice, sort, page, limit } =
    serviceQuerySchema.parse(req.query);

  const where: Prisma.ServiceWhereInput = {
    isActive: true,
    categoryId, // undefined → Prisma ignores it
    price: { gte: minPrice, lte: maxPrice }, // undefined parts are ignored too
    category: { isActive: true },
    technician: {
      isAvailable: true,
      user: { status: "ACTIVE" },
      ...(location && { location: { contains: location, mode: "insensitive" } }),
    },
    ...(search && {
      OR: [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ],
    }),
  };

  const [services, total] = await prisma.$transaction([
    prisma.service.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
        technician: {
          select: {
            id: true,
            location: true,
            avgRating: true,
            user: { select: { name: true } },
          },
        },
      },
      orderBy: sortOptions[sort],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.service.count({ where }),
  ]);

  sendResponse(res, {
    statusCode: 200,
    message: "Services fetched",
    data: services,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

export default router;

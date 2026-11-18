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

// ---------- Bookings ----------
const listBookingsQuery = z.object({
    status: z.enum(["REQUESTED", "ACCEPTED", "DECLINED", "PAID", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10),
});

// GET /api/admin/bookings → all bookings
router.get("/bookings", async (req, res) => {
    const { status, page, limit } = listBookingsQuery.parse(req.query);
    const where: Prisma.BookingWhereInput = { status };

    const [bookings, total] = await prisma.$transaction([
        prisma.booking.findMany({
            where,
            include: {
                service: { select: { title: true } },
                customer: { select: { name: true, email: true } },
                technician: { select: { user: { select: { name: true, email: true } } } },
            },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.booking.count({ where }),
    ]);

    sendResponse(res, {
        statusCode: 200,
        message: "Bookings fetched",
        data: bookings,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
});

// ---------- Categories ----------
const createCategorySchema = z.object({
    name: z.string().min(2).max(50),
    description: z.string().max(500).optional(),
});

const updateCategorySchema = createCategorySchema.partial().extend({
    isActive: z.boolean().optional(),
});

// GET /api/admin/categories → all categories (including inactive)
router.get("/categories", async (_req, res) => {
    const categories = await prisma.category.findMany({
        include: { _count: { select: { services: true } } },
        orderBy: { name: "asc" },
    });

    sendResponse(res, { statusCode: 200, message: "Categories fetched", data: categories });
});

// POST /api/admin/categories → create
router.post("/categories", validate(createCategorySchema), async (req, res) => {
    const { name, description } = req.body as z.infer<typeof createCategorySchema>;

    const existing = await prisma.category.findUnique({ where: { name } });
    if (existing) {
        throw new ApiError(409, "Category already exists");
    }

    const category = await prisma.category.create({ data: { name, description } });
    sendResponse(res, { statusCode: 201, message: "Category created", data: category });
});

// PATCH /api/admin/categories/:id → edit / hide / show
router.patch("/categories/:id", validate(updateCategorySchema), async (req, res) => {
    const categoryId = req.params.id as string;
    const data = req.body as z.infer<typeof updateCategorySchema>;

    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) {
        throw new ApiError(404, "Category not found");
    }

    // Renaming? The new name must not belong to another category
    if (data.name && data.name !== category.name) {
        const taken = await prisma.category.findUnique({ where: { name: data.name } });
        if (taken) {
            throw new ApiError(409, "Category name already in use");
        }
    }

    const updated = await prisma.category.update({ where: { id: categoryId }, data });
    sendResponse(res, { statusCode: 200, message: "Category updated", data: updated });
});


export default router;

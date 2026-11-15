import { Router } from "express";
import z from "zod";
import { auth } from "../../middlewares/auth.js";
import { prisma } from "../../config/prisma.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { validate } from "../../middlewares/validate.js";
import { ApiError } from "../../utils/ApiError.js";
import type { BookingStatus } from "../../generated/prisma/enums.js";



const router = Router();

const updatedProfileSchema = z.object({
    bio: z.string().max(500).optional(),
    skills: z.array(z.string().min(1)).min(1).optional(),
    experienceYears: z.number().int().min(0).max(60).optional(),
    location: z.string().min(2).optional(),
    isAvailable: z.boolean().optional()
})


const createServiceSchema = z.object({
    categoryId: z.string().min(1),
    title: z.string().min(3).max(100),
    description: z.string().max(1000).optional(),
    price: z.number().positive(),
    durationMinutes: z.number().int().min(15).max(480).optional(),
});

const updateServiceSchema = createServiceSchema.partial();

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/; // "00:00" to "23:59"

const slotSchema = z
    .object({
        dayOfWeek: z.number().int().min(0).max(6),
        startTime: z.string().regex(timeRegex, "Time must be HH:mm"),
        endTime: z.string().regex(timeRegex, "Time must be HH:mm"),
    })
    .refine((slot) => slot.startTime < slot.endTime, {
        message: "endTime must be after startTime",
        path: ["endTime"],
    });


const availabilitySchema = z.object({
    slots: z.array(slotSchema).max(50),
});

router.get("/profile", auth("TECHNICIAN"), async (req, res) => {
    const profile = await prisma.technicianProfile.findUnique({
        where: { userId: req.user!.id },
        include: { user: { omit: { password: true } } }
    });
    sendResponse(res, { statusCode: 200, message: "Profile fetched", data: profile });
})

router.put("/profile", auth('TECHNICIAN'), validate(updatedProfileSchema), async (req, res) => {
    const data = req.body as z.infer<typeof updatedProfileSchema>;
    const profile = await prisma.technicianProfile.update({
        where: { userId: req.user!.id },
        data
    })
    sendResponse(res, { statusCode: 200, message: "Profile updated", data: profile })
});

// POST /api/technician/services → create a service
router.post("/services", auth("TECHNICIAN"), validate(createServiceSchema), async (req, res) => {
    const data = req.body as z.infer<typeof createServiceSchema>;

    // 1. Find MY profile (services belong to the profile, not the user)
    const profile = await prisma.technicianProfile.findUnique({ where: { userId: req.user!.id } });
    if (!profile) {
        throw new ApiError(404, "Technician profile not found");
    }

    // 2. Does the category exist and is it active?
    const category = await prisma.category.findUnique({ where: { id: data.categoryId } });
    if (!category || !category.isActive) {
        throw new ApiError(404, "Category not found");
    }

    // 3. Create the service, linked to my profile
    const service = await prisma.service.create({
        data: { ...data, technicianId: profile.id },
        include: { category: true },
    });

    sendResponse(res, { statusCode: 201, message: "Service created", data: service });
});

// GET /api/technician/services → my services
router.get("/services", auth("TECHNICIAN"), async (req, res) => {
    const services = await prisma.service.findMany({
        where: { technician: { userId: req.user!.id }, isActive: true },
        include: { category: true },
        orderBy: { createdAt: "desc" },
    });

    sendResponse(res, { statusCode: 200, message: "My services fetched", data: services });
});

const findMyService = async (serviceId: string, userId: string) => {
    const service = await prisma.service.findFirst({
        where: { id: serviceId, technician: { userId } }
    })

    if (!service) {
        throw new ApiError(404, "Service not found")
    }

    return service;
}

router.patch("/services/:id", auth("TECHNICIAN"), validate(updateServiceSchema), async (req, res) => {
    const id = req.params.id as string;
    const data = req.body as z.infer<typeof updateServiceSchema>
    await findMyService(id, req.user!.id);
    // check category if exist
    if (data.categoryId) {
        const category = await prisma.category.findUnique({
            where: { id: data.categoryId }
        });

        if (!category || !category.isActive) {
            throw new ApiError(404, "category not found")
        }
    }

    const service = await prisma.service.update({
        where: { id },
        data,
        include: { category: true }
    });

    sendResponse(res, { statusCode: 200, message: "Service Updated", data: service })

})

router.delete("/services/:id", auth("TECHNICIAN"), async (req, res) => {
    const id = req.params.id as string;
    await findMyService(id, req.user!.id);

    await prisma.service.update({
        where: { id },
        data: { isActive: false },
    });

    sendResponse(res, { statusCode: 200, message: "Service deleted" });
});

// GET /api/technician/availability → my weekly schedule
router.get("/availability", auth("TECHNICIAN"), async (req, res) => {
    const slots = await prisma.availabilitySlot.findMany({
        where: { technician: { userId: req.user!.id } },
        orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    });

    sendResponse(res, { statusCode: 200, message: "Availability fetched", data: slots });
});

// PUT /api/technician/availability → replace my whole weekly schedule
router.put("/availability", auth("TECHNICIAN"), validate(availabilitySchema), async (req, res) => {
    const { slots } = req.body as z.infer<typeof availabilitySchema>;

    const profile = await prisma.technicianProfile.findUnique({ where: { userId: req.user!.id } });
    if (!profile) {
        throw new ApiError(404, "Technician profile not found");
    }

    // Overlap check: sort by day + start, then compare each slot with the previous one
    const sorted = [...slots].sort(
        (a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime),
    );
    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]!;
        const curr = sorted[i]!;
        if (prev.dayOfWeek === curr.dayOfWeek && curr.startTime < prev.endTime) {
            throw new ApiError(400, `Overlapping slots on day ${curr.dayOfWeek}`);
        }
    }

    // Replace: delete old slots + create new ones, all-or-nothing
    await prisma.$transaction([
        prisma.availabilitySlot.deleteMany({ where: { technicianId: profile.id } }),
        prisma.availabilitySlot.createMany({
            data: slots.map((slot) => ({ ...slot, technicianId: profile.id })),
        }),
    ]);

    const saved = await prisma.availabilitySlot.findMany({
        where: { technicianId: profile.id },
        orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    });

    sendResponse(res, { statusCode: 200, message: "Availability updated", data: saved });
});

const technicianTransitions: Partial<Record<BookingStatus, BookingStatus[]>> = {
    REQUESTED: ["ACCEPTED", 'DECLINED'],
    PAID: ['IN_PROGRESS'],
    IN_PROGRESS: ['COMPLETED']
}

const updateBookStatusSchema = z.object({
    status: z.enum(["ACCEPTED", "DECLINED", "IN_PROGRESS", "COMPLETED"])
})

router.patch("/bookings/:id", auth('TECHNICIAN'), validate(updateBookStatusSchema), async (req, res) => {
    const bookingId = req.params.id as string;
    const { status } = req.body as z.infer<typeof updateBookStatusSchema>;

    const booking = await prisma.booking.findFirst({
        where: { id: bookingId, technician: { userId: req.user!.id } }
    })

    if (!booking) {
        throw new ApiError(404, "Booking not found")
    }

    const allowed = technicianTransitions[booking.status] ?? [];
    if (!allowed.includes(status)) {
        throw new ApiError(400, `Cannot change booking from ${booking.status} to ${status}`)
    }

    const updated = await prisma.booking.update({
        where: { id: bookingId },
        data: { status },
    })

    sendResponse(res, { statusCode: 200, message: `Booking ${status.toLowerCase()}`, data: updated });
})

export default router;
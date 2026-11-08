import { Router } from "express";
import z from "zod";
import { auth } from "../../middlewares/auth.js";
import { prisma } from "../../config/prisma.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { validate } from "../../middlewares/validate.js";
import { ApiError } from "../../utils/ApiError.js";



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

export default router;
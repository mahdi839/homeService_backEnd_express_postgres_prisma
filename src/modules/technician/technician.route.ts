import { Router } from "express";
import z from "zod";
import { auth } from "../../middlewares/auth.js";
import { prisma } from "../../config/prisma.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { validate } from "../../middlewares/validate.js";



const router = Router();
const updatedProfileSchema = z.object({
    bio: z.string().max(500).optional(),
    skills: z.array(z.string().min(1)).min(1).optional(),
    experienceYears: z.number().int().min(0).max(60).optional(),
    location: z.string().min(2).optional(),
    isAvailable: z.boolean().optional()
})

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
})

export default router;
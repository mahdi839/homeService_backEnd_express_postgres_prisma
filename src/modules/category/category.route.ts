import { Router } from "express";
import z from "zod";
import { prisma } from "../../config/prisma.js";
import { sendResponse } from "../../utils/sendResponse.js";



const router = Router();
router.get("/", async (req, res) => {
    const categories = await prisma.category.findMany(
        {
            where: { isActive: true },
            orderBy: {name: "asc"}
        }

    );
    sendResponse(res, { statusCode: 200, message: "categories fatched", data: categories })
})


export default router;


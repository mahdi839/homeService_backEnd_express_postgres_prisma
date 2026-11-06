import { Router } from "express";
import z from "zod";
import { auth } from "../../middlewares/auth.js";
import { validate } from "../../middlewares/validate.js";
import { prisma } from "../../config/prisma.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { ApiError } from "../../utils/ApiError.js";


const router = Router();
const categorySchema = z.object({
    name: z.string().min(2),
    description: z.string().optional()
})

router.get("/", async (req, res) => {
    const categories = await prisma.category.findMany(
        {
            where: { isActive: true },
            orderBy: {name: "asc"}
        }

    );
    sendResponse(res, { statusCode: 200, message: "categories fatched", data: categories })
})

router.post("/", auth('ADMIN'), validate(categorySchema), async (req, res) => {
    const { name, description } = req.body as z.infer<typeof categorySchema>;
    const existCategory = await prisma.category.findUnique(
        { where: { name } }
    )
    if(existCategory){
        throw new ApiError(409,"Category already exists")
    }

    const category = await prisma.category.create({
        data:{name,description}
    });

    sendResponse(res,{statusCode:201,message:"category created",data:category})
})

export default router;


import { Router } from "express";
import z  from "zod";
import { validate } from "../../middlewares/validate.js";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/ApiError.js";
import bcrypt from "bcryptjs";
import { sendResponse } from "../../utils/sendResponse.js";


const router = Router();

const registerSchema = z.object({
    name: z.string().min(2),
    email: z.email(),
    password: z.string().min(6),
    phone: z.string().optional(),
    role: z.enum(["CUSTOMER", "TECHNICIAN"]),
})

router.post("/register",validate(registerSchema),async(req,res)=>{
    const { name, email, password, phone, role } = req.body as z.infer<typeof registerSchema>;


    // 1. is the email already used?
    const existing = await prisma.user.findUnique({
        where:{email}
    });

    if(existing){
        throw new ApiError (409, "Email already registered!")
    };

    // 2. hash password
    const hashedPassword = await bcrypt.hash(password,10);

    // save the user
    const user = await prisma.user.create({
        data:{name,email,password:hashedPassword,phone,role},
        omit:{password:true},
    });

    sendResponse(res,{statusCode:201,message:"user registered",data:user});

});

export default router;
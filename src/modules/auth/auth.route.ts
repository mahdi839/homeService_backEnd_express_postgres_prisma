import { Router, type Response } from "express";
import z from "zod";
import { validate } from "../../middlewares/validate.js";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/ApiError.js";
import bcrypt from "bcryptjs";
import { sendResponse } from "../../utils/sendResponse.js";
import { env } from "../../config/env.js";
import  jwt from "jsonwebtoken";
import { auth } from "../../middlewares/auth.js";


const router = Router();

const registerSchema = z.object({
    name: z.string().min(2),
    email: z.email(),
    password: z.string().min(6),
    phone: z.string().optional(),
    role: z.enum(["CUSTOMER", "TECHNICIAN"]),
})

router.post("/register", validate(registerSchema), async (req, res) => {
    const { name, email, password, phone, role } = req.body as z.infer<typeof registerSchema>;


    // 1. is the email already used?
    const existing = await prisma.user.findUnique({
        where: { email }
    });

    if (existing) {
        throw new ApiError(409, "Email already registered!")
    };

    // 2. hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // save the user
    const user = await prisma.user.create({
        data: {
             name, 
             email, 
             password: hashedPassword, 
             phone, 
             role,
             ...(role === "TECHNICIAN"&& {technicianProfile: {create:{}}})
            },
        omit: { password: true },
        include: {technicianProfile:true}
    });

    sendResponse(res, { statusCode: 201, message: "user registered", data: user });

});

const loginSchema = z.object({
    email: z.email(),
    password: z.string().min(1)
})

// login api started from here-------------

router.post("/login", validate(loginSchema), async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;

    const user = await prisma.user.findUnique({ where: { email } });
    const passwordOk = user && (await bcrypt.compare(password, user.password));

    if (!user || !passwordOk) {
        throw new ApiError(401, "Invalid email or password");
    }

    if (user.status == "BANNED") {
        throw new ApiError(403, "your account has been banned")
    }

    const token = jwt.sign({ id: user.id, role: user.role }, env.JWT_SECRET, {
        expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    });

    const {password:_password,...userWithoutPassword} = user;
    sendResponse(res,{
        statusCode:200,
        message:"login successful",
        data: {token,user: userWithoutPassword}
    })

})

router.get("/me",auth(),async(req,res)=>{
   const user = await prisma.user.findUniqueOrThrow(
     {
        where:{
            id:req.user!.id},
        omit:{password:true}
     }
   );

   sendResponse(res,{statusCode:200,message:"current User",data:user});
})

export default router;
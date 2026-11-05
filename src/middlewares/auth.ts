import type { NextFunction, Request, Response } from "express";
import type { Role } from "../generated/prisma/enums.js";
import { ApiError } from "../utils/ApiError.js";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";

export const auth = (...allowdRoles: Role[]) =>
    async (req: Request, res: Response, next: NextFunction) => {
        const header = req.headers.authorization;
        if (!header?.startsWith("Bearer ")) {
            throw new ApiError(401, "You are not logged in");
        }

        const token = header.slice(7);

        // varify the token
        let payload: { id: string, role: Role };
        try {
            payload = jwt.verify(token, env.JWT_SECRET) as { id: string, role: Role }
        } catch {
            throw new ApiError(401, "Invalid or expired token");
        }

        const user = await prisma.user.findUniqueOrThrow(
            { where: { id: payload.id } });
        if (!user) {
            throw new ApiError(401, "User no longer exist")
        }

        if (user.status === "BANNED") {
            throw new ApiError(403, "Your account has been banned");
        }

        if (allowdRoles.length > 0 && !allowdRoles.includes(user.role)) {
            throw new ApiError(403, "You do not have right permission")
        }

        req.user = { id: user.id, role: user.role };
        next();
    }
import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError.js";
import { env } from "../config/env.js";
import { ZodError } from "zod";

export const errorHandler = (
    err: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
) => {
    
    // 1. Our own errors: we know the status code
    if (err instanceof ApiError) {
        return res.status(err.statusCode).json({
            success: false,
            message: err.message,
            errorDetails: err.errorDetails,
        });
    }

    // 2. Validation errors from Zod → 400 with a list of wrong fields
    if (err instanceof ZodError) {
        return res.status(400).json({
            success: false,
            message: "Validation failed",
            errorDetails: err.issues.map((issue) => ({
                field: issue.path.join("."),
                message: issue.message,
            })),
        });
    }


    // 3. Anything else is an unexpected bug → 500
    console.error(err);
    return res.status(500).json({
        success: false,
        message: "Something went wrong",
        errorDetails: env.NODE_ENV === "development" ? String(err) : null,
    });
};

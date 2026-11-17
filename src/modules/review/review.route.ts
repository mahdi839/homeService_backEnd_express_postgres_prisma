import { Router } from "express";
import { z } from "zod";
import { auth } from "../../middlewares/auth.js";
import { validate } from "../../middlewares/validate.js";
import { prisma } from "../../config/prisma.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { ApiError } from "../../utils/ApiError.js";

const router = Router();

const createReviewSchema = z.object({
  bookingId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

// POST /api/reviews → customer reviews a completed booking
router.post("/", auth("CUSTOMER"), validate(createReviewSchema), async (req, res) => {
  const { bookingId, rating, comment } = req.body as z.infer<typeof createReviewSchema>;

  // 1. Must be MY booking, and it must be completed
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, customerId: req.user!.id },
    include: { review: true },
  });
  if (!booking) {
    throw new ApiError(404, "Booking not found");
  }
  if (booking.status !== "COMPLETED") {
    throw new ApiError(400, "You can only review a completed booking");
  }

  // 2. Only one review per booking
  if (booking.review) {
    throw new ApiError(409, "You have already reviewed this booking");
  }

  // 3. Save review + recalculate rating, all-or-nothing
  const review = await prisma.$transaction(async (tx) => {
    const created = await tx.review.create({
      data: {
        bookingId,
        customerId: req.user!.id,
        technicianId: booking.technicianId,
        rating,
        comment,
      },
    });

    const stats = await tx.review.aggregate({
      where: { technicianId: booking.technicianId },
      _avg: { rating: true },
      _count: true,
    });

    await tx.technicianProfile.update({
      where: { id: booking.technicianId },
      data: {
        avgRating: stats._avg.rating ?? 0,
        reviewCount: stats._count,
      },
    });

    return created;
  });

  sendResponse(res, { statusCode: 201, message: "Review submitted", data: review });
});

export default router;

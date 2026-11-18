import { Router } from "express";
import { includes, z } from "zod";
import { auth } from "../../middlewares/auth.js";
import { validate } from "../../middlewares/validate.js";
import { prisma } from "../../config/prisma.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { ApiError } from "../../utils/ApiError.js";
import { title } from "node:process";
import type { BookingStatus } from "../../generated/prisma/enums.js";
const router = Router();

// Business time zone: Bangladesh = UTC+6 (no daylight saving)
const UTC_OFFSET_HOURS = 6;

// Convert a UTC date into local { day: 0-6, time: "HH:mm" }
const toLocalDayAndTime = (date: Date) => {
  const local = new Date(date.getTime() + UTC_OFFSET_HOURS * 60 * 60 * 1000);
  return {
    day: local.getUTCDay(),
    time: local.toISOString().slice(11, 16), // "2026-11-20T10:30:00.000Z" → "10:30"
  };
};

const createBookingSchema = z.object({
  serviceId: z.string().min(1),
  scheduledStart: z.iso.datetime({ offset: true }),
  address: z.string().min(5).max(300),
  notes: z.string().max(1000).optional(),
});

// POST /api/bookings → customer books a service
router.post("/", auth("CUSTOMER"), validate(createBookingSchema), async (req, res) => {
  const { serviceId, scheduledStart, address, notes } = req.body as z.infer<typeof createBookingSchema>;

  // 1. Service must exist, be active, and its technician must be available + active
  const service = await prisma.service.findFirst({
    where: {
      id: serviceId,
      isActive: true,
      technician: { isAvailable: true, user: { status: "ACTIVE" } },
    },
  });
  if (!service) {
    throw new ApiError(404, "Service not found or not available");
  }

  // 2. Start must be in the future; end = start + service duration
  const start = new Date(scheduledStart);
  if (start <= new Date()) {
    throw new ApiError(400, "Booking time must be in the future");
  }
  const end = new Date(start.getTime() + service.durationMinutes * 60 * 1000);

  // 3. Must fit inside one of the technician's availability slots
  const localStart = toLocalDayAndTime(start);
  const localEnd = toLocalDayAndTime(end);
  if (localStart.day !== localEnd.day) {
    throw new ApiError(400, "Booking must start and end on the same day");
  }

  const slot = await prisma.availabilitySlot.findFirst({
    where: {
      technicianId: service.technicianId,
      dayOfWeek: localStart.day,
      startTime: { lte: localStart.time },
      endTime: { gte: localEnd.time },
    },
  });
  if (!slot) {
    throw new ApiError(400, "Technician is not available at this time");
  }

  // 4. No overlap with the technician's other active bookings
  const clash = await prisma.booking.findFirst({
    where: {
      technicianId: service.technicianId,
      status: { in: ["REQUESTED", "ACCEPTED", "PAID", "IN_PROGRESS"] },
      scheduledStart: { lt: end },
      scheduledEnd: { gt: start },
    },
  });
  if (clash) {
    throw new ApiError(409, "Technician already has a booking at this time");
  }

  // 5. Create the booking (price is copied from the service)
  const booking = await prisma.booking.create({
    data: {
      customerId: req.user!.id,
      technicianId: service.technicianId,
      serviceId: service.id,
      scheduledStart: start,
      scheduledEnd: end,
      address,
      notes,
      price: service.price,
    },
    include: { service: { select: { title: true } } },
  });

  sendResponse(res, { statusCode: 201, message: "Booking requested", data: booking });
});

const listBookingsQuery = z.object({
  status: z.enum(["REQUESTED", "ACCEPTED", "DECLINED", "PAID", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional()
});

router.get("/", auth(), async (req, res) => {
  const { status } = listBookingsQuery.parse(req.query);
  const { id, role } = req.user!;

  const bookings = await prisma.booking.findMany({
    where: {
      status,
      ...(role === "CUSTOMER" && { customerId: id }),
      ...(role === "TECHNICIAN" && { technician: { userId: id } }),
    },
    include: {
      service: { select: { title: true } },
      customer: { select: { name: true, phone: true } },
      technician: { select: { user: { select: { name: true, phone: true } } } },
    },
    orderBy: { scheduledStart: "desc" },
  });

  sendResponse(res, { statusCode: 200, message: "Bookings fetched", data: bookings });
});

router.get("/:id", auth(), async (req, res) => {
  const bookingId = req.params.id as string;
  const { id, role } = req.user!;

  const booking = await prisma.booking.findFirst({
    where: {
      id: bookingId,
      ...(role === 'CUSTOMER' && { customerId: id }),
      ...(role === 'TECHNICIAN' && { technician: { userId: id } }),
    },
    include: {
      service: { include: { category: { select: { name: true } } } },
      customer: { select: { name: true, phone: true, email: true } },
      technician: { select: { user: { select: { name: true, phone: true } } } }
    }
  })

  if (!booking) {
    throw new ApiError(404, "Booking not found")
  }
  sendResponse(res, { statusCode: 200, message: "Booking fetched", data: booking })
})

const technicianTransitions: Partial<Record<BookingStatus, BookingStatus[]>> = {
  REQUESTED: ["ACCEPTED", 'DECLINED'],
  PAID: ['IN_PROGRESS'],
  IN_PROGRESS: ['COMPLETED']
}

const updateBookStatusSchema = z.object({
  status: z.enum(["ACCEPTED", "DECLINED", "IN_PROGRESS", "COMPLETED"])
})

router.patch("/:id", auth('TECHNICIAN'), validate(updateBookStatusSchema), async (req, res) => {
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
});

const cancelBookingSchema = z.object({
  reason: z.string().max(500).optional(),
})

const CANCELLABLE_STATUSES = ["REQUESTED", "ACCEPTED", "PAID"];

router.patch("/:id/cancel", auth("CUSTOMER"), validate(cancelBookingSchema), async (req, res) => {
  const bookingId = req.params.id as string;
  const { reason } = req.body as z.infer<typeof cancelBookingSchema>;

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, customerId: req.user!.id }
  });

  if (!booking) {
    throw new ApiError(404, "Booking not found")
  }

  if (!CANCELLABLE_STATUSES.includes(booking.status)) {
    throw new ApiError(400, `Cannot cancel booking that is ${booking.status}`)
  };

  // TODO (Stripe): if booking.status === "PAID", refund the payment here

  const cancelled = await prisma.booking.update({
    where: { id: bookingId },
    data: { status: 'CANCELLED', cancelReason: reason }
  });

  sendResponse(res, { statusCode: 200, message: "Booking Cancelled", data: cancelled })
})

export default router;

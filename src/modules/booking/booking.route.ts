import { Router } from "express";
import { z } from "zod";
import { auth } from "../../middlewares/auth.js";
import { validate } from "../../middlewares/validate.js";
import { prisma } from "../../config/prisma.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { ApiError } from "../../utils/ApiError.js";

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

export default router;

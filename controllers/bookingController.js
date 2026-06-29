const bookingModel = require("../models/bookingModel");
const auditModel = require("../models/auditModel");
const { emitEvent } = require("../socket");
const { sendBookingConfirmation, sendStatusUpdate } = require("../services/notificationService");

async function addBooking(req, res, next) {
  try {
    const { name, event, datetime, phone, email, resource } = req.body;

    const conflict = await bookingModel.findConflict({ event, datetime, resource });
    if (conflict) {
      return res.status(409).json({
        success: false,
        message: resource && conflict.resource === resource
          ? `"${resource}" is already booked at this exact time.`
          : `"${event}" already has a booking at this exact time. Pick a different slot.`,
      });
    }

    const booking = await bookingModel.addBooking({
      name,
      event,
      datetime,
      phone,
      email,
      resource,
      createdBy: req.user ? { id: req.user.id, name: req.user.name } : null,
    });

    emitEvent("booking:created", booking);

    auditModel.logAction({
      action: "created",
      bookingId: booking._id,
      summary: `Created booking "${booking.event}" for ${booking.name}.`,
      performedBy: req.user,
    });

    sendBookingConfirmation(booking).catch((err) => console.error("Confirmation email failed:", err.message));

    res.status(201).json({ success: true, data: booking });
  } catch (err) {
    next(err);
  }
}

async function getAllBookings(req, res, next) {
  try {
    const { q, status, from, to, sortBy, order, page, limit } = req.query;
    const result = await bookingModel.getAllBookings({
      q,
      status,
      from,
      to,
      sortBy,
      order,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 0,
    });
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

async function updateBooking(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await bookingModel.getBookingById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    const nextEvent = req.body.event ?? existing.event;
    const nextDatetime = req.body.datetime ?? existing.datetime;
    const nextResource = req.body.resource ?? existing.resource;
    const conflict = await bookingModel.findConflict({ event: nextEvent, datetime: nextDatetime, resource: nextResource }, id);
    if (conflict) {
      return res.status(409).json({
        success: false,
        message: `"${nextEvent}" already has a booking at this exact time.`,
      });
    }

    const statusChanged = req.body.status && req.body.status !== existing.status;
    const updated = await bookingModel.updateBooking(id, req.body);
    emitEvent("booking:updated", updated);

    auditModel.logAction({
      action: statusChanged ? "status_changed" : "updated",
      bookingId: id,
      summary: statusChanged
        ? `Marked "${existing.event}" as ${updated.status}.`
        : `Edited booking "${updated.event}" for ${updated.name}.`,
      performedBy: req.user,
    });

    if (statusChanged) {
      sendStatusUpdate(updated).catch((err) => console.error("Status email failed:", err.message));
    }

    res.status(200).json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

async function deleteBooking(req, res, next) {
  try {
    const { id } = req.params;
    const deleted = await bookingModel.deleteBooking(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }
    emitEvent("booking:deleted", { _id: id });

    auditModel.logAction({
      action: "deleted",
      bookingId: id,
      summary: `Deleted booking "${deleted.event}" for ${deleted.name}.`,
      performedBy: req.user,
    });

    res.status(200).json({ success: true, data: deleted });
  } catch (err) {
    next(err);
  }
}

async function getStats(req, res, next) {
  try {
    const stats = await bookingModel.getStats();
    res.status(200).json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
}

module.exports = { addBooking, getAllBookings, updateBooking, deleteBooking, getStats };

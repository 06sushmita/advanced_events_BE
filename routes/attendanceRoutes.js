const express = require("express");
const { ObjectId } = require("mongodb");
const attendanceModel = require("../models/attendanceModel");
const eventModel = require("../models/eventModel");
const registrationModel = require("../models/registrationModel");
const notificationModel = require("../models/notificationModel");
const { requireAuth } = require("../middleware/auth");
const { emitEvent } = require("../socket");

const router = express.Router();

// Record attendance check-in (Organizer/Volunteer scans QR token)
router.post("/check-in", requireAuth, async (req, res, next) => {
  try {
    const { token, eventId } = req.body;
    if (!token || !eventId) {
      return res.status(400).json({ success: false, message: "Token and Event ID are required." });
    }

    const event = await eventModel.getEventById(eventId);
    if (!event) return res.status(404).json({ success: false, message: "Event not found." });

    // Validate authority: User scanning must be Admin, Organizer of event, or a volunteer for this event
    const isOrganizer = event.organizerId.toString() === req.user.id;
    const isVolunteer = event.volunteers.some(v => v.userId.toString() === req.user.id);
    const isAdmin = req.user.role === "admin";

    if (!isAdmin && !isOrganizer && !isVolunteer) {
      return res.status(403).json({ success: false, message: "You do not have permission to check-in attendees." });
    }

    // Token is userId for simplicity in QR code scan (or secure signed token)
    let participantId;
    if (ObjectId.isValid(token) && token.length === 24) {
      participantId = new ObjectId(token);
    } else {
      try {
        const jwt = require("jsonwebtoken");
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.type !== "checkin") {
          return res.status(400).json({ success: false, message: "Invalid check-in token type." });
        }
        if (decoded.eventId !== eventId) {
          return res.status(400).json({ success: false, message: "Token is for a different event." });
        }
        participantId = new ObjectId(decoded.userId);
      } catch (err) {
        return res.status(400).json({ success: false, message: "Invalid or expired check-in token." });
      }
    }

    // Verify registration status
    const reg = await registrationModel.findUserRegistration(participantId, eventId);
    if (!reg || reg.status !== "registered") {
      return res.status(400).json({ success: false, message: "Participant is not registered for this event." });
    }

    const checkInRecord = await attendanceModel.checkIn({
      userId: participantId,
      eventId,
      verifiedBy: req.user.id
    });

    // Get participant user details
    const participant = await getDB().collection("users").findOne({ _id: participantId });
    const name = participant ? participant.name : "Attendee";

    // Notify participant
    await notificationModel.createNotification(
      participantId,
      `Your attendance for "${event.title}" has been verified.`
    );

    // Broadcast check-in event for real-time dashboard tracking
    emitEvent("attendance:checkin", {
      eventId,
      userId: participantId,
      name,
      checkInTime: checkInRecord.checkInTime,
    });

    res.json({
      success: true,
      message: `Checked in successfully: ${name}`,
      data: checkInRecord
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Participant's history
router.get("/history", requireAuth, async (req, res, next) => {
  try {
    const list = await attendanceModel.getAttendanceHistory(req.user.id);
    res.json({ success: true, data: list });
  } catch (err) {
    next(err);
  }
});

// Event specific check-ins (Organizer Dashboard)
router.get("/event/:eventId", requireAuth, async (req, res, next) => {
  try {
    const event = await eventModel.getEventById(req.params.eventId);
    if (!event) return res.status(404).json({ success: false, message: "Event not found." });

    const isOrganizer = event.organizerId.toString() === req.user.id;
    const isAdmin = req.user.role === "admin";
    if (!isAdmin && !isOrganizer) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const list = await attendanceModel.getEventAttendance(req.params.eventId);
    res.json({ success: true, data: list });
  } catch (err) {
    next(err);
  }
});

// Helper database get function
function getDB() {
  return require("../config/db").getDB();
}

module.exports = router;

const express = require("express");
const { ObjectId } = require("mongodb");
const eventModel = require("../models/eventModel");
const registrationModel = require("../models/registrationModel");
const teamModel = require("../models/teamModel");
const notificationModel = require("../models/notificationModel");
const { requireAuth, requireRole } = require("../middleware/auth");
const { emitEvent } = require("../socket");
const { getDB } = require("../config/db");
const jwt = require("jsonwebtoken");
const { sendRegistrationConfirmation } = require("../services/notificationService");

const router = express.Router();

function validateEventDates(datetime, deadline) {
  const eventDate = new Date(datetime);
  if (isNaN(eventDate.getTime())) {
    return { valid: false, message: "Invalid event date format." };
  }
  if (eventDate < new Date()) {
    return { valid: false, message: "Event date cannot be in the past." };
  }
  if (eventDate.getFullYear() > 2100) {
    return { valid: false, message: "Event date is too far in the future." };
  }

  if (deadline) {
    const deadlineDate = new Date(deadline);
    if (isNaN(deadlineDate.getTime())) {
      return { valid: false, message: "Invalid registration deadline format." };
    }
    if (deadlineDate > eventDate) {
      return { valid: false, message: "Registration deadline cannot be after the event date." };
    }
  }
  return { valid: true };
}

router.validateEventDates = validateEventDates;

// List all events
router.get("/", async (req, res, next) => {
  try {
    const { q, category, status, organizerId, page, limit } = req.query;
    const result = await eventModel.getAllEvents({
      q,
      category,
      status: status || "active",
      organizerId,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 0,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// Get current user registrations
router.get("/my-registrations", requireAuth, async (req, res, next) => {
  try {
    const list = await registrationModel.getUserRegistrations(req.user.id);
    res.json({ success: true, data: list });
  } catch (err) {
    next(err);
  }
});

// Organizer analytics
router.get("/my-analytics", requireAuth, async (req, res, next) => {
  try {
    const db = getDB();
    const events = await eventModel.getAllEvents({ organizerId: req.user.id });
    const eventList = events.data || [];
    const eventIds = eventList.map(e => e._id);

    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const now = new Date();

    // Build 6-month trends with real registration + attendance data
    const trends = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

      const [registrationsCount, checkinsCount] = await Promise.all([
        eventIds.length > 0
          ? db.collection("registrations").countDocuments({
              eventId: { $in: eventIds },
              status: "registered",
              createdAt: { $gte: startOfMonth, $lte: endOfMonth },
            })
          : 0,
        eventIds.length > 0
          ? db.collection("attendance").countDocuments({
              eventId: { $in: eventIds },
              verified: true,
              checkInTime: { $gte: startOfMonth, $lte: endOfMonth },
            })
          : 0,
      ]);

      trends.push({
        month: monthNames[d.getMonth()],
        registrations: registrationsCount,
        checkins: checkinsCount,
      });
    }

    // Fallback: if all monthly buckets are 0 but registrations exist
    // (can happen when createdAt field is missing from seeded data)
    const orgTrendTotal = trends.reduce((sum, t) => sum + t.registrations, 0);
    if (orgTrendTotal === 0 && eventIds.length > 0) {
      const orgTotalRegs = await db.collection("registrations").countDocuments({
        eventId: { $in: eventIds },
        status: "registered",
      });
      if (orgTotalRegs > 0) {
        trends[trends.length - 1].registrations = orgTotalRegs;
      }
    }

    // Weekly engagement with real views
    const engagement = [];
    for (let i = 7; i >= 0; i--) {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - i * 7);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);

      const [signups, views] = await Promise.all([
        eventIds.length > 0
          ? db.collection("registrations").countDocuments({
              eventId: { $in: eventIds },
              status: "registered",
              createdAt: { $gte: weekStart, $lt: weekEnd },
            })
          : 0,
        eventIds.length > 0
          ? db.collection("event_views").countDocuments({
              eventId: { $in: eventIds },
              viewedAt: { $gte: weekStart, $lt: weekEnd },
            })
          : 0,
      ]);

      engagement.push({ week: `W${8 - i}`, views, signups });
    }

    res.json({ success: true, data: { trends, engagement } });
  } catch (err) {
    next(err);
  }
});

// Get single event
router.get("/:id", async (req, res, next) => {
  try {
    const event = await eventModel.getEventById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: "Event not found." });
    // Record page view (fire-and-forget)
    getDB().collection("event_views").insertOne({
      eventId: new ObjectId(req.params.id),
      viewedAt: new Date(),
    }).catch(() => {});
    res.json({ success: true, data: event });
  } catch (err) {
    next(err);
  }
});

// Create event
router.post("/", requireAuth, requireRole("organizer", "admin"), async (req, res, next) => {
  try {
    // If organizer, ensure they are approved
    if (req.user.role === "organizer" && req.user.isApproved === false) {
      return res.status(403).json({ success: false, message: "Your organizer account is pending admin approval." });
    }

    const { title, description, category, datetime, location, capacity, deadline, schedule, image, price } = req.body;
    if (!title || !datetime || !capacity) {
      return res.status(400).json({ success: false, message: "Title, datetime, and capacity are required." });
    }

    const dateVal = validateEventDates(datetime, deadline);
    if (!dateVal.valid) {
      return res.status(400).json({ success: false, message: dateVal.message });
    }

    const event = await eventModel.createEvent({
      title,
      description,
      category,
      datetime,
      location,
      capacity,
      price,
      deadline: deadline || datetime,
      organizerId: req.user.id,
      schedule,
      image,
    });

    emitEvent("event:created", event);
    res.status(201).json({ success: true, data: event });
  } catch (err) {
    next(err);
  }
});

// Update event
router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const event = await eventModel.getEventById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: "Event not found." });

    // Verify ownership
    if (req.user.role !== "admin" && event.organizerId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "You don't have permission to modify this event." });
    }

    if (req.body.datetime !== undefined) {
      const checkDeadline = req.body.deadline !== undefined ? req.body.deadline : event.deadline;
      const dateVal = validateEventDates(req.body.datetime, checkDeadline);
      if (!dateVal.valid) {
        return res.status(400).json({ success: false, message: dateVal.message });
      }
    } else if (req.body.deadline !== undefined && event.datetime) {
      const dateVal = validateEventDates(event.datetime, req.body.deadline);
      if (!dateVal.valid) {
        return res.status(400).json({ success: false, message: dateVal.message });
      }
    }

    const updated = await eventModel.updateEvent(req.params.id, req.body);
    emitEvent("event:updated", updated);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// Delete event
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const event = await eventModel.getEventById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: "Event not found." });

    // Verify ownership
    if (req.user.role !== "admin" && event.organizerId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "You don't have permission to delete this event." });
    }

    await eventModel.deleteEvent(req.params.id);
    emitEvent("event:deleted", { _id: req.params.id });
    res.json({ success: true, message: "Event deleted successfully." });
  } catch (err) {
    next(err);
  }
});

// Register for event
router.post("/:id/register", requireAuth, async (req, res, next) => {
  try {
    const { quantity } = req.body;
    const result = await registrationModel.registerUser({
      userId: req.user.id,
      eventId: req.params.id,
      quantity: Number(quantity) || 1,
    });

    // Notify user
    await notificationModel.createNotification(
      req.user.id,
      result.status === "waitlisted"
        ? `You have been waitlisted for event: ${result.eventTitle}`
        : `Successfully registered for event: ${result.eventTitle}`
    );

    // Send QR ticket email for confirmed (non-waitlisted) registrations
    if (result.status === "registered") {
      const event = await eventModel.getEventById(req.params.id);
      if (event) {
        sendRegistrationConfirmation(
          { id: req.user.id, name: req.user.name, email: req.user.email },
          event
        ).catch((err) => console.error("QR ticket email failed:", err.message));
      }
    }

    emitEvent("registration:new", { eventId: req.params.id, userId: req.user.id, status: result.status });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Cancel registration
router.post("/:id/cancel", requireAuth, async (req, res, next) => {
  try {
    const result = await registrationModel.cancelRegistration(req.user.id, req.params.id);

    // Check if someone got allocated from waitlist
    const event = await eventModel.getEventById(req.params.id);
    if (event && event.waitlist && event.waitlist.length > 0) {
      // allocateFromWaitlist now returns array of promoted user IDs
      const allocatedIds = await registrationModel.collection().find({
        eventId: new ObjectId(req.params.id),
        status: "registered",
        allocatedAt: { $exists: true },
      }).toArray();

      for (const allocatedReg of allocatedIds) {
        await notificationModel.createNotification(
          allocatedReg.userId,
          `Great news! You have been moved from the waitlist and registered for: ${event.title}`
        );
        // Fetch the user and send them their QR ticket email
        const db = getDB();
        const allocatedUser = await db.collection("users").findOne({ _id: new ObjectId(allocatedReg.userId) });
        if (allocatedUser && allocatedUser.email) {
          sendRegistrationConfirmation(
            { id: allocatedUser._id.toString(), name: allocatedUser.name, email: allocatedUser.email },
            event
          ).catch((err) => console.error("Waitlist QR ticket email failed:", err.message));
        }
      }
    }

    emitEvent("registration:cancelled", { eventId: req.params.id, userId: req.user.id });
    res.json({ success: true, message: "Registration cancelled successfully." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Get registration status for current user
router.get("/:id/my-status", requireAuth, async (req, res, next) => {
  try {
    const reg = await registrationModel.findUserRegistration(req.user.id, req.params.id);
    const team = await teamModel.getTeamByEventAndUser(req.params.id, req.user.id);

    let checkInToken = null;
    if (reg && reg.status === "registered") {
      checkInToken = jwt.sign(
        { userId: req.user.id, eventId: req.params.id, type: "checkin" },
        process.env.JWT_SECRET,
        { expiresIn: "24h" }
      );
    }

    res.json({
      success: true,
      registered: !!reg,
      status: reg ? reg.status : null,
      team: team,
      checkInToken
    });
  } catch (err) {
    next(err);
  }
});

// Email QR ticket to the current registered user
router.post("/:id/email-ticket", requireAuth, async (req, res, next) => {
  try {
    const reg = await registrationModel.findUserRegistration(req.user.id, req.params.id);
    if (!reg || reg.status !== "registered") {
      return res.status(403).json({ success: false, message: "You are not registered for this event." });
    }

    const event = await eventModel.getEventById(req.params.id);
    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found." });
    }

    await sendRegistrationConfirmation(
      { id: req.user.id, name: req.user.name, email: req.user.email },
      event
    );

    res.json({ success: true, message: `QR ticket sent to ${req.user.email}` });
  } catch (err) {
    next(err);
  }
});

// Get registrations list (Organizer only)
router.get("/:id/registrations", requireAuth, async (req, res, next) => {
  try {
    const event = await eventModel.getEventById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: "Event not found." });

    if (req.user.role !== "admin" && event.organizerId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const list = await registrationModel.getEventRegistrations(req.params.id);
    res.json({ success: true, data: list });
  } catch (err) {
    next(err);
  }
});

// Volunteer Task assignment
router.post("/:id/volunteers", requireAuth, async (req, res, next) => {
  try {
    const event = await eventModel.getEventById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: "Event not found." });

    if (req.user.role !== "admin" && event.organizerId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const { email, task } = req.body;
    const volunteer = await getDB().collection("users").findOne({ email: email.toLowerCase().trim() });
    if (!volunteer) return res.status(404).json({ success: false, message: "User not found with that email." });

    const newVolunteers = [...event.volunteers.filter(v => v.userId.toString() !== volunteer._id.toString()), {
      userId: volunteer._id,
      name: volunteer.name,
      task
    }];

    const updated = await eventModel.updateEvent(req.params.id, { volunteers: newVolunteers });
    await notificationModel.createNotification(
      volunteer._id,
      `You have been assigned the volunteer task: "${task}" for event "${event.title}".`
    );

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// Team registration - Create team
router.post("/:id/teams/create", requireAuth, async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, message: "Team name is required." });

    // Verify registered for event first
    const reg = await registrationModel.findUserRegistration(req.user.id, req.params.id);
    if (!reg || reg.status !== "registered") {
      return res.status(400).json({ success: false, message: "You must be registered for this event to create a team." });
    }

    const team = await teamModel.createTeam({
      name,
      eventId: req.params.id,
      leaderId: req.user.id,
      leaderName: req.user.name,
      leaderEmail: req.user.email
    });

    // Update registration with teamId
    await registrationModel.collection().updateOne(
      { _id: reg._id },
      { $set: { teamId: team._id } }
    );

    res.status(201).json({ success: true, data: team });
  } catch (err) {
    next(err);
  }
});

// Team registration - Join team
router.post("/:id/teams/join", requireAuth, async (req, res, next) => {
  try {
    const { teamId } = req.body;
    if (!teamId) return res.status(400).json({ success: false, message: "Team ID is required." });

    // Verify registered for event first
    const reg = await registrationModel.findUserRegistration(req.user.id, req.params.id);
    if (!reg || reg.status !== "registered") {
      return res.status(400).json({ success: false, message: "You must be registered for this event to join a team." });
    }

    const team = await teamModel.addMember(teamId, {
      userId: req.user.id,
      name: req.user.name,
      email: req.user.email
    });

    // Update registration with teamId
    await registrationModel.collection().updateOne(
      { _id: reg._id },
      { $set: { teamId: new ObjectId(teamId) } }
    );

    res.json({ success: true, data: team });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;

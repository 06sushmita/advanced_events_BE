const express = require("express");
const { ObjectId } = require("mongodb");
const { requireAuth, requireRole } = require("../middleware/auth");
const { getDB } = require("../config/db");

const router = express.Router();

// ── Public endpoint (no auth) ──────────────────────────────────────────────
// Returns real platform-wide stats for the landing page hero section.
router.get("/stats/public", async (req, res, next) => {
  try {
    const db = getDB();
    const [totalEvents, totalTickets, totalAttendance, totalRegistrations, totalOrganizers] =
      await Promise.all([
        db.collection("events").countDocuments(),
        db.collection("registrations").countDocuments({ status: "registered" }),
        db.collection("attendance").countDocuments({ verified: true }),
        db.collection("registrations").countDocuments({ status: "registered" }),
        db.collection("users").countDocuments({ role: "organizer" }),
      ]);

    const avgAttendance =
      totalRegistrations > 0
        ? Math.round((totalAttendance / totalRegistrations) * 100)
        : 0;

    res.json({
      success: true,
      data: {
        totalEvents,
        totalTickets,
        avgAttendance,
        totalOrganizers,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── Admin-only routes below ────────────────────────────────────────────────
router.use(requireAuth, requireRole("admin"));

// Get all users
router.get("/users", async (req, res, next) => {
  try {
    const list = await getDB().collection("users").find({}).toArray();
    // Exclude password hashes
    const safeList = list.map(u => {
      const { passwordHash, ...safe } = u;
      return safe;
    });
    res.json({ success: true, data: safeList });
  } catch (err) {
    next(err);
  }
});

// Approve an organizer
router.put("/users/:id/approve-organizer", async (req, res, next) => {
  try {
    const result = await getDB().collection("users").findOneAndUpdate(
      { _id: new ObjectId(req.params.id), role: "organizer" },
      { $set: { isApproved: true } },
      { returnDocument: "after" }
    );
    if (!result) {
      return res.status(404).json({ success: false, message: "Organizer not found." });
    }
    res.json({ success: true, message: "Organizer approved successfully.", user: result });
  } catch (err) {
    next(err);
  }
});

// Disapprove/Suspend an organizer
router.put("/users/:id/disapprove-organizer", async (req, res, next) => {
  try {
    const result = await getDB().collection("users").findOneAndUpdate(
      { _id: new ObjectId(req.params.id), role: "organizer" },
      { $set: { isApproved: false } },
      { returnDocument: "after" }
    );
    if (!result) {
      return res.status(404).json({ success: false, message: "Organizer not found." });
    }
    res.json({ success: true, message: "Organizer disapproved successfully.", user: result });
  } catch (err) {
    next(err);
  }
});

// Get system statistics (Analytics Dashboard)
router.get("/analytics", async (req, res, next) => {
  try {
    const db = getDB();

    const [
      totalUsers,
      totalOrganizers,
      totalParticipants,
      totalEvents,
      totalRegistrations,
      totalAttendance,
    ] = await Promise.all([
      db.collection("users").countDocuments(),
      db.collection("users").countDocuments({ role: "organizer" }),
      db.collection("users").countDocuments({ role: "participant" }),
      db.collection("events").countDocuments(),
      db.collection("registrations").countDocuments({ status: "registered" }),
      db.collection("attendance").countDocuments({ verified: true }),
    ]);

    // Popular events (top 5 by registration count)
    const popularEvents = await db.collection("events")
      .find({ status: "active" })
      .sort({ registrationsCount: -1 })
      .limit(5)
      .toArray();

    // Attendance percentage
    const attendancePercentage = totalRegistrations > 0
      ? Math.round((totalAttendance / totalRegistrations) * 100)
      : 0;

    // Calculate trends data dynamically for the last 6 months from the database
    const trends = [];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const now = new Date();
    
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
      
      const [registrationsCount, checkinsCount] = await Promise.all([
        db.collection("registrations").countDocuments({
          status: "registered",
          createdAt: { $gte: startOfMonth, $lte: endOfMonth }
        }),
        db.collection("attendance").countDocuments({
          verified: true,
          checkInTime: { $gte: startOfMonth, $lte: endOfMonth }
        })
      ]);
      
      trends.push({
        month: months[d.getMonth()],
        registrations: registrationsCount,
        checkins: checkinsCount
      });
    }

    // Fallback: if all monthly buckets are 0 but DB has registrations
    // (can happen if registrations were seeded/inserted without createdAt),
    // put the total count in the current month so the chart shows real data.
    const trendTotal = trends.reduce((sum, t) => sum + t.registrations, 0);
    if (trendTotal === 0 && totalRegistrations > 0) {
      trends[trends.length - 1].registrations = totalRegistrations;
    }

    // Category breakdown — group events by category for pie chart
    const categoryAgg = await db.collection("events").aggregate([
      { $group: { _id: "$category", value: { $sum: 1 } } },
      { $sort: { value: -1 } },
    ]).toArray();
    const categoryBreakdown = categoryAgg.map((c) => ({
      name: c._id || "General",
      value: c.value,
    }));

    // Weekly engagement — registrations (sign-ups) and real page views per week for last 8 weeks
    const engagement = [];
    for (let i = 7; i >= 0; i--) {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - i * 7);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);

      const [signups, views] = await Promise.all([
        db.collection("registrations").countDocuments({
          status: "registered",
          createdAt: { $gte: weekStart, $lt: weekEnd },
        }),
        db.collection("event_views").countDocuments({
          viewedAt: { $gte: weekStart, $lt: weekEnd },
        }),
      ]);

      const label = `W${8 - i}`;
      engagement.push({ week: label, views, signups });
    }

    res.json({
      success: true,
      data: {
        stats: {
          totalUsers,
          totalOrganizers,
          totalParticipants,
          totalEvents,
          totalRegistrations,
          totalAttendance,
          attendancePercentage
        },
        popularEvents,
        trends,
        categoryBreakdown,
        engagement,
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

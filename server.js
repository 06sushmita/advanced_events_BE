const path = require("path");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const http = require("http");

const bookingRoutes = require("./routes/bookingRoutes");
const authRoutes = require("./routes/authRoutes");
const auditRoutes = require("./routes/auditRoutes");
const eventRoutes = require("./routes/eventRoutes");
const attendanceRoutes = require("./routes/attendanceRoutes");
const adminRoutes = require("./routes/adminRoutes");
const aiRoutes = require("./routes/aiRoutes");
const { connectDB, getDB } = require("./config/db");
const { initSocket } = require("./socket");
const { notFound, errorHandler } = require("./middleware/errorHandler");
const { apiLimiter } = require("./middleware/rateLimit");
const { startReminderJob } = require("./services/reminderJob");

const app = express();
const server = http.createServer(app);

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "*" }));
app.use(express.json());
app.use(morgan("dev"));
app.use(apiLimiter);

app.use("/auth", authRoutes);
app.use("/audit", auditRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/ai", aiRoutes);
app.use("/", bookingRoutes);

// ── Public stats (no auth) ─────────────────────────────────────────────────
app.get("/api/stats/public", async (req, res, next) => {
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
      data: { totalEvents, totalTickets, avgAttendance, totalOrganizers },
    });
  } catch (err) {
    next(err);
  }
});

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 9000;

connectDB()
  .then(() => {
    initSocket(server);
    startReminderJob();
    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log("Realtime updates active via Socket.io");
    });
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB:", err.message);
    process.exit(1);
  });

process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  server.close(() => process.exit(0));
});

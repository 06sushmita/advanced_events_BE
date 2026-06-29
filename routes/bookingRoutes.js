const express = require("express");
const bookingController = require("../controllers/bookingController");
const validateBooking = require("../middleware/validateBooking");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.get("/health", (req, res) => res.json({ success: true, message: "OK" }));

router.get("/get", requireAuth, bookingController.getAllBookings);
router.get("/stats", requireAuth, bookingController.getStats);
router.post("/add", requireAuth, validateBooking, bookingController.addBooking);
router.put("/update/:id", requireAuth, bookingController.updateBooking);
// Hard delete is admin-only — staff can still "cancel" a booking via status update.
router.delete("/delete/:id", requireAuth, requireRole("admin"), bookingController.deleteBooking);

module.exports = router;

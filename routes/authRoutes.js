const express = require("express");
const authController = require("../controllers/authController");
const { requireAuth } = require("../middleware/auth");
const { authLimiter } = require("../middleware/rateLimit");

const router = express.Router();

router.post("/register", authLimiter, authController.register);
router.post("/login", authLimiter, authController.login);
router.post("/forgot-password", authLimiter, authController.forgotPassword);
router.get("/me", requireAuth, authController.me);

module.exports = router;

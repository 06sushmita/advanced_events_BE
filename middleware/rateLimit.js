const rateLimit = require("express-rate-limit");

/** Generous general-purpose limit — mostly there to blunt accidental loops or abuse. */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please slow down." },
});

/** Tighter limit specifically on login/register to blunt brute-force / credential stuffing. */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts. Try again in a few minutes." },
});

module.exports = { apiLimiter, authLimiter };

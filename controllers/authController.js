const userModel = require("../models/userModel");
const { hashPassword, comparePassword } = require("../utils/password");
const { signToken } = require("../utils/jwt");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function register(req, res, next) {
  try {
    const { name, email, password, role, interests } = req.body;
    const errors = [];

    if (!name || !name.trim()) errors.push("Name is required.");
    if (!email || !EMAIL_REGEX.test(email)) errors.push("A valid email is required.");
    if (!password || password.length < 6) errors.push("Password must be at least 6 characters.");
    if (role && !["organizer", "participant"].includes(role)) errors.push("Invalid role selected.");
    if (errors.length) return res.status(400).json({ success: false, errors });

    const existing = await userModel.findByEmail(email);
    if (existing) {
      return res.status(409).json({ success: false, message: "An account with that email already exists." });
    }

    const passwordHash = await hashPassword(password);
    const user = await userModel.createUser({ name: name.trim(), email, passwordHash, role, interests });

    const token = signToken({ id: user._id, name: user.name, email: user.email, role: user.role, isApproved: user.isApproved });
    res.status(201).json({ success: true, token, user: userModel.toSafeUser(user) });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    const user = await userModel.findByEmail(email);
    if (!user) {
      return res.status(401).json({ success: false, message: "Incorrect email or password." });
    }

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ success: false, message: "Incorrect email or password." });
    }

    const token = signToken({ id: user._id, name: user.name, email: user.email, role: user.role, isApproved: user.isApproved });
    res.status(200).json({ success: true, token, user: userModel.toSafeUser(user) });
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    const user = await userModel.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    res.status(200).json({ success: true, user: userModel.toSafeUser(user) });
  } catch (err) {
    next(err);
  }
}

async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }
    const user = await userModel.findByEmail(email);
    if (!user) {
      // Return 200 for security reasons (don't leak registered emails)
      return res.status(200).json({ success: true, message: "If an account exists, a recovery link has been sent." });
    }

    // Mock sending recovery link
    console.log("\n--- [forgot-password:console-fallback] ---");
    console.log(`To:      ${email}`);
    console.log(`Subject: Reset your password`);
    console.log(`Recovery Link: http://localhost:5173/reset-password?token=mockToken1234&email=${email}`);
    console.log("-------------------------------------------\n");

    res.status(200).json({ success: true, message: "If an account exists, a recovery link has been sent." });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, me, forgotPassword };

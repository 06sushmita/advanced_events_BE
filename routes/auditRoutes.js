const express = require("express");
const auditController = require("../controllers/auditController");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, requireRole("admin"), auditController.getLogs);

module.exports = router;

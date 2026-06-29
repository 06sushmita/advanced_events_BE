const express = require("express");
const aiController = require("../controllers/aiController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.post("/chat", aiController.chat);
router.post("/generate-description", aiController.generateDescription);
router.get("/recommendations", requireAuth, aiController.getRecommendations);
router.post("/generate-report/:eventId", requireAuth, aiController.generateReport);

module.exports = router;

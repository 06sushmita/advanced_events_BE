const auditModel = require("../models/auditModel");

async function getLogs(req, res, next) {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const logs = await auditModel.getRecentLogs(limit);
    res.status(200).json({ success: true, data: logs });
  } catch (err) {
    next(err);
  }
}

module.exports = { getLogs };

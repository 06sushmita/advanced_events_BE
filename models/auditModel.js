const { getDB } = require("../config/db");

const COLLECTION = "auditLogs";

function collection() {
  return getDB().collection(COLLECTION);
}

/**
 * Records who did what to which booking. Fire-and-forget from the
 * controllers — a logging failure should never block the actual
 * booking action, so callers don't need to await this on the critical
 * path (though they may if they want to be sure it lands).
 */
async function logAction({ action, bookingId, summary, performedBy }) {
  try {
    await collection().insertOne({
      action, // "created" | "updated" | "status_changed" | "deleted"
      bookingId: String(bookingId),
      summary,
      performedBy: performedBy ? { id: performedBy.id, name: performedBy.name, role: performedBy.role } : null,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error("Failed to write audit log:", err.message);
  }
}

async function getRecentLogs(limit = 50) {
  return collection().find().sort({ createdAt: -1 }).limit(limit).toArray();
}

module.exports = { logAction, getRecentLogs };

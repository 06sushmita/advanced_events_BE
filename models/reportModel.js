const { ObjectId } = require("mongodb");
const { getDB } = require("../config/db");

const COLLECTION = "reports";

function collection() {
  return getDB().collection(COLLECTION);
}

async function createReport({ eventId, summary, attendanceStats, engagementMetrics, insights }) {
  // Check if exists, replace or create
  const existing = await collection().findOne({ eventId: new ObjectId(eventId) });

  const doc = {
    eventId: new ObjectId(eventId),
    summary: summary ? summary.trim() : "",
    attendanceStats: attendanceStats || { totalRegistered: 0, totalCheckedIn: 0, rate: 0 },
    engagementMetrics: engagementMetrics || { chatQueriesCount: 0, feedbackCount: 0 },
    insights: insights ? insights.trim() : "",
    generatedAt: new Date(),
  };

  if (existing) {
    await collection().updateOne({ _id: existing._id }, { $set: doc });
    return { _id: existing._id, ...doc };
  } else {
    const result = await collection().insertOne(doc);
    return { _id: result.insertedId, ...doc };
  }
}

async function getReportByEventId(eventId) {
  try {
    return await collection().findOne({ eventId: new ObjectId(eventId) });
  } catch {
    return null;
  }
}

module.exports = {
  createReport,
  getReportByEventId,
  collection,
};

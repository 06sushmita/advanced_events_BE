const { ObjectId } = require("mongodb");
const { getDB } = require("../config/db");

const COLLECTION = "attendance";

function collection() {
  return getDB().collection(COLLECTION);
}

async function checkIn({ userId, eventId, verifiedBy }) {
  const existing = await collection().findOne({
    userId: new ObjectId(userId),
    eventId: new ObjectId(eventId)
  });

  if (existing) {
    if (existing.verified) {
      throw new Error("User has already checked in for this event.");
    }
    await collection().updateOne(
      { _id: existing._id },
      { $set: { verified: true, checkInTime: new Date(), verifiedBy: new ObjectId(verifiedBy) } }
    );
    return { ...existing, verified: true, checkInTime: new Date(), verifiedBy };
  }

  const doc = {
    userId: new ObjectId(userId),
    eventId: new ObjectId(eventId),
    verified: true,
    checkInTime: new Date(),
    verifiedBy: new ObjectId(verifiedBy),
  };
  const result = await collection().insertOne(doc);
  return { _id: result.insertedId, ...doc };
}

async function getAttendanceHistory(userId) {
  const list = await collection().find({ userId: new ObjectId(userId), verified: true }).toArray();
  const eventIds = list.map(a => a.eventId);

  const events = await getDB().collection("events").find({ _id: { $in: eventIds } }).toArray();
  const eventMap = events.reduce((acc, e) => {
    acc[e._id.toString()] = e;
    return acc;
  }, {});

  return list.map(a => ({
    ...a,
    event: eventMap[a.eventId.toString()] || null
  }));
}

async function getEventAttendance(eventId) {
  const list = await collection().find({ eventId: new ObjectId(eventId) }).toArray();
  const userIds = list.map(a => a.userId);

  const users = await getDB().collection("users").find({ _id: { $in: userIds } }).toArray();
  const userMap = users.reduce((acc, u) => {
    acc[u._id.toString()] = u;
    return acc;
  }, {});

  return list.map(a => ({
    ...a,
    user: userMap[a.userId.toString()] 
      ? { name: userMap[a.userId.toString()].name, email: userMap[a.userId.toString()].email }
      : null
  }));
}

async function isAttended(userId, eventId) {
  const doc = await collection().findOne({
    userId: new ObjectId(userId),
    eventId: new ObjectId(eventId),
    verified: true
  });
  return !!doc;
}

module.exports = {
  checkIn,
  getAttendanceHistory,
  getEventAttendance,
  isAttended,
  collection,
};

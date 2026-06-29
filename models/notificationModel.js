const { ObjectId } = require("mongodb");
const { getDB } = require("../config/db");

const COLLECTION = "notifications";

function collection() {
  return getDB().collection(COLLECTION);
}

async function createNotification(userId, content) {
  const doc = {
    userId: new ObjectId(userId),
    content: content.trim(),
    isRead: false,
    createdAt: new Date(),
  };
  const result = await collection().insertOne(doc);
  return { _id: result.insertedId, ...doc };
}

async function getUserNotifications(userId) {
  return await collection()
    .find({ userId: new ObjectId(userId) })
    .sort({ createdAt: -1 })
    .limit(30)
    .toArray();
}

async function markAsRead(id) {
  try {
    await collection().updateOne(
      { _id: new ObjectId(id) },
      { $set: { isRead: true } }
    );
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  createNotification,
  getUserNotifications,
  markAsRead,
  collection,
};

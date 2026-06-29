const { ObjectId } = require("mongodb");
const { getDB } = require("../config/db");

const COLLECTION = "events";

function collection() {
  return getDB().collection(COLLECTION);
}

async function createEvent(eventData) {
  const doc = {
    title: eventData.title.trim(),
    description: eventData.description ? eventData.description.trim() : "",
    category: eventData.category || "General",
    datetime: eventData.datetime, // ISO string
    location: eventData.location || "Online",
    capacity: Number(eventData.capacity) || 100,
    price: Number(eventData.price) || 0,
    deadline: eventData.deadline, // ISO string
    organizerId: new ObjectId(eventData.organizerId),
    schedule: Array.isArray(eventData.schedule) ? eventData.schedule : [],
    volunteers: Array.isArray(eventData.volunteers) ? eventData.volunteers : [],
    waitlist: [], // [{ userId, registeredAt }]
    registrationsCount: 0,
    image: eventData.image || "",
    status: eventData.status || "active", // draft, active, cancelled, completed
    createdAt: new Date(),
  };
  const result = await collection().insertOne(doc);
  return { _id: result.insertedId, ...doc };
}

async function getEventById(id) {
  try {
    return await collection().findOne({ _id: new ObjectId(id) });
  } catch {
    return null;
  }
}

async function getAllEvents({ q, category, status, organizerId, limit = 0, page = 1 }) {
  const query = {};

  if (q) {
    query.$or = [
      { title: { $regex: q, $options: "i" } },
      { description: { $regex: q, $options: "i" } },
      { location: { $regex: q, $options: "i" } },
    ];
  }
  if (category) {
    query.category = category;
  }
  if (status) {
    query.status = status;
  }
  if (organizerId) {
    query.organizerId = new ObjectId(organizerId);
  }

  const cursor = collection().find(query).sort({ datetime: 1 });

  if (limit > 0) {
    cursor.skip((page - 1) * limit).limit(limit);
  }

  const data = await cursor.toArray();
  const total = await collection().countDocuments(query);

  return { data, total };
}

async function updateEvent(id, updateData) {
  const fields = {};
  if (updateData.title !== undefined) fields.title = updateData.title.trim();
  if (updateData.description !== undefined) fields.description = updateData.description.trim();
  if (updateData.category !== undefined) fields.category = updateData.category;
  if (updateData.datetime !== undefined) fields.datetime = updateData.datetime;
  if (updateData.location !== undefined) fields.location = updateData.location;
  if (updateData.capacity !== undefined) fields.capacity = Number(updateData.capacity);
  if (updateData.deadline !== undefined) fields.deadline = updateData.deadline;
  if (updateData.schedule !== undefined) fields.schedule = updateData.schedule;
  if (updateData.volunteers !== undefined) fields.volunteers = updateData.volunteers;
  if (updateData.status !== undefined) fields.status = updateData.status;
  if (updateData.image !== undefined) fields.image = updateData.image;
  if (updateData.price !== undefined) fields.price = Number(updateData.price) || 0;

  await collection().updateOne({ _id: new ObjectId(id) }, { $set: fields });
  return getEventById(id);
}

async function deleteEvent(id) {
  const event = await getEventById(id);
  if (!event) return null;
  await collection().deleteOne({ _id: new ObjectId(id) });
  return event;
}

// Checks if a user is already registered for an event at the same datetime
async function findConflict(userId, datetime) {
  // Find all active event registrations of this user
  const userRegs = await getDB().collection("registrations").find({
    userId: new ObjectId(userId),
    status: "registered"
  }).toArray();

  if (userRegs.length === 0) return null;

  const eventIds = userRegs.map(r => r.eventId);
  
  // Find if any of those registered events share the exact same datetime
  const conflictingEvent = await collection().findOne({
    _id: { $in: eventIds },
    datetime: datetime,
    status: "active"
  });

  return conflictingEvent; // returns the conflicting event doc if any
}

module.exports = {
  createEvent,
  getEventById,
  getAllEvents,
  updateEvent,
  deleteEvent,
  findConflict,
  collection,
};

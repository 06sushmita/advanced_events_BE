const { ObjectId } = require("mongodb");
const { getDB } = require("../config/db");

const COLLECTION = "events";

function collection() {
  return getDB().collection(COLLECTION);
}

/**
 * A conflict is either the same event booked twice at the same instant,
 * or — if a resource (room/equipment) was specified — that resource
 * being double-booked regardless of event name. Resource is optional,
 * so bookings without one only get the event-level check.
 */
async function findConflict({ event, datetime, resource }, excludeId) {
  const or = [{ event, datetime }];
  if (resource) or.push({ resource, datetime });

  const query = { $or: or };
  if (excludeId) query._id = { $ne: new ObjectId(excludeId) };
  return collection().findOne(query);
}

async function addBooking(data) {
  const doc = {
    name: data.name,
    event: data.event,
    datetime: data.datetime,
    phone: data.phone,
    email: data.email || null,
    resource: data.resource || null,
    status: data.status || "pending",
    reminderSent: false,
    createdBy: data.createdBy || null, // { id, name } of the user who made the booking
    createdAt: new Date(),
  };
  const result = await collection().insertOne(doc);
  return { _id: result.insertedId, ...doc };
}

/**
 * Supports free-text search, status filtering, a date range, sorting and
 * pagination — all through query params, all in a single round trip.
 */
async function getAllBookings({
  q,
  status,
  from,
  to,
  sortBy = "datetime",
  order = "asc",
  page = 1,
  limit = 0,
} = {}) {
  const filter = {};

  if (q) {
    const regex = new RegExp(q.trim(), "i");
    filter.$or = [{ name: regex }, { event: regex }, { phone: regex }];
  }
  if (status) filter.status = status;
  if (from || to) {
    filter.datetime = {};
    if (from) filter.datetime.$gte = from;
    if (to) filter.datetime.$lte = to;
  }

  const safeSortBy = ["datetime", "name", "event", "status", "createdAt"].includes(sortBy)
    ? sortBy
    : "datetime";
  const sortDir = order === "desc" ? -1 : 1;

  const total = await collection().countDocuments(filter);
  let cursor = collection()
    .find(filter)
    .sort({ [safeSortBy]: sortDir });

  if (limit && limit > 0) {
    cursor = cursor.skip((Math.max(page, 1) - 1) * limit).limit(limit);
  }

  const data = await cursor.toArray();
  return { data, total, page: Number(page) || 1, limit: Number(limit) || total };
}

async function getBookingById(id) {
  return collection().findOne({ _id: new ObjectId(id) });
}

async function updateBooking(id, data) {
  const update = { ...data };
  delete update._id;
  delete update.createdAt;
  await collection().updateOne({ _id: new ObjectId(id) }, { $set: update });
  return getBookingById(id);
}

async function deleteBooking(id) {
  const booking = await getBookingById(id);
  if (!booking) return null;
  await collection().deleteOne({ _id: new ObjectId(id) });
  return booking;
}

/** Lightweight counts the dashboard renders without re-fetching every row. */
async function getStats() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  const all = await collection().find().toArray();

  const total = all.length;
  let today = 0;
  let upcoming = 0;
  let past = 0;
  const byStatus = { pending: 0, confirmed: 0, cancelled: 0 };

  for (const b of all) {
    const d = new Date(b.datetime);
    if (d >= startOfDay && d < endOfDay) today += 1;
    if (d > now) upcoming += 1;
    else past += 1;
    const key = b.status || "pending";
    byStatus[key] = (byStatus[key] || 0) + 1;
  }

  return { total, today, upcoming, past, byStatus };
}

/** Bookings starting within [now, horizon] that haven't been reminded about yet. */
async function getBookingsDueForReminder(now, horizon) {
  return collection()
    .find({
      reminderSent: { $ne: true },
      status: { $ne: "cancelled" },
      datetime: { $gte: now.toISOString().slice(0, 16), $lte: horizon.toISOString().slice(0, 16) },
    })
    .toArray();
}

async function markReminderSent(id) {
  await collection().updateOne({ _id: new ObjectId(id) }, { $set: { reminderSent: true } });
}

module.exports = {
  addBooking,
  getAllBookings,
  getBookingById,
  updateBooking,
  deleteBooking,
  getStats,
  findConflict,
  getBookingsDueForReminder,
  markReminderSent,
};

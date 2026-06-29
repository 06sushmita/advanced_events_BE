const { ObjectId } = require("mongodb");
const { getDB } = require("../config/db");
const eventModel = require("./eventModel");

const COLLECTION = "registrations";

function collection() {
  return getDB().collection(COLLECTION);
}

async function findUserRegistration(userId, eventId) {
  try {
    return await collection().findOne({
      userId: new ObjectId(userId),
      eventId: new ObjectId(eventId),
      status: { $in: ["registered", "waitlisted"] }
    });
  } catch {
    return null;
  }
}

async function registerUser({ userId, eventId, teamId = null }) {
  const event = await eventModel.getEventById(eventId);
  if (!event) throw new Error("Event not found.");

  if (new Date() > new Date(event.deadline)) {
    throw new Error("Registration deadline has passed.");
  }

  const existing = await findUserRegistration(userId, eventId);
  if (existing) {
    throw new Error("You are already registered or waitlisted for this event.");
  }

  // Conflict detection
  const conflict = await eventModel.findConflict(userId, event.datetime);
  if (conflict) {
    throw new Error(`Time conflict! You are already registered for "${conflict.title}" at this time.`);
  }

  const isFull = event.registrationsCount >= event.capacity;
  const status = isFull ? "waitlisted" : "registered";

  const doc = {
    userId: new ObjectId(userId),
    eventId: new ObjectId(eventId),
    teamId: teamId ? new ObjectId(teamId) : null,
    status, // registered, waitlisted, cancelled
    createdAt: new Date(),
  };

  if (status === "registered") {
    // Increment registration count
    await eventModel.collection().updateOne(
      { _id: new ObjectId(eventId) },
      { $inc: { registrationsCount: 1 } }
    );
  } else {
    // Append to event's waitlist
    await eventModel.collection().updateOne(
      { _id: new ObjectId(eventId) },
      { $push: { waitlist: { userId: new ObjectId(userId), registeredAt: new Date() } } }
    );
  }

  const result = await collection().insertOne(doc);
  return { _id: result.insertedId, ...doc, eventTitle: event.title };
}

async function cancelRegistration(userId, eventId) {
  const reg = await collection().findOne({
    userId: new ObjectId(userId),
    eventId: new ObjectId(eventId),
    status: { $in: ["registered", "waitlisted"] }
  });

  if (!reg) throw new Error("No active registration found.");

  await collection().updateOne(
    { _id: reg._id },
    { $set: { status: "cancelled", cancelledAt: new Date() } }
  );

  const event = await eventModel.getEventById(eventId);
  if (!event) return { success: true };

  if (reg.status === "registered") {
    // Decrement registrationsCount
    await eventModel.collection().updateOne(
      { _id: new ObjectId(eventId) },
      { $inc: { registrationsCount: -1 } }
    );

    // Trigger waitlist allocation
    await allocateFromWaitlist(eventId);
  } else {
    // Remove from event's waitlist array
    await eventModel.collection().updateOne(
      { _id: new ObjectId(eventId) },
      { $pull: { waitlist: { userId: new ObjectId(userId) } } }
    );
  }

  return { success: true };
}

async function allocateFromWaitlist(eventId) {
  const event = await eventModel.getEventById(eventId);
  if (!event || event.waitlist.length === 0) return;

  // Get the first user on the waitlist
  const nextUser = event.waitlist[0];
  const userId = nextUser.userId;

  // Remove them from event's waitlist array
  await eventModel.collection().updateOne(
    { _id: new ObjectId(eventId) },
    { $pop: { waitlist: -1 } } // Pop first element
  );

  // Update registration record to "registered"
  const updatedReg = await collection().findOneAndUpdate(
    { userId: new ObjectId(userId), eventId: new ObjectId(eventId), status: "waitlisted" },
    { $set: { status: "registered", allocatedAt: new Date() } },
    { returnDocument: "after" }
  );

  if (updatedReg) {
    // Increment registrations count
    await eventModel.collection().updateOne(
      { _id: new ObjectId(eventId) },
      { $inc: { registrationsCount: 1 } }
    );

    // Create Notification & Email Trigger in calling router/controller
    return updatedReg;
  }
}

async function getUserRegistrations(userId) {
  const regs = await collection().find({ userId: new ObjectId(userId) }).toArray();
  const eventIds = regs.map(r => r.eventId);

  const events = await eventModel.collection().find({ _id: { $in: eventIds } }).toArray();
  const eventMap = events.reduce((acc, e) => {
    acc[e._id.toString()] = e;
    return acc;
  }, {});

  return regs.map(r => ({
    ...r,
    event: eventMap[r.eventId.toString()] || null
  }));
}

async function getEventRegistrations(eventId) {
  const regs = await collection().find({ eventId: new ObjectId(eventId) }).toArray();
  const userIds = regs.map(r => r.userId);

  const users = await getDB().collection("users").find({ _id: { $in: userIds } }).toArray();
  const userMap = users.reduce((acc, u) => {
    acc[u._id.toString()] = u;
    return acc;
  }, {});

  return regs.map(r => ({
    ...r,
    user: userMap[r.userId.toString()] 
      ? { name: userMap[r.userId.toString()].name, email: userMap[r.userId.toString()].email }
      : null
  }));
}

module.exports = {
  registerUser,
  cancelRegistration,
  getUserRegistrations,
  getEventRegistrations,
  findUserRegistration,
  collection,
};

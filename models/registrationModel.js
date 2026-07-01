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

async function registerUser({ userId, eventId, teamId = null, quantity = 1 }) {
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

  const qty = Number(quantity) || 1;
  const isFull = (event.registrationsCount || 0) + qty > event.capacity;
  const status = isFull ? "waitlisted" : "registered";

  const doc = {
    userId: new ObjectId(userId),
    eventId: new ObjectId(eventId),
    teamId: teamId ? new ObjectId(teamId) : null,
    status, // registered, waitlisted, cancelled
    quantity: qty,
    createdAt: new Date(),
  };

  if (status === "registered") {
    // Increment registration count by quantity
    await eventModel.collection().updateOne(
      { _id: new ObjectId(eventId) },
      { $inc: { registrationsCount: qty } }
    );
  } else {
    // Append to event's waitlist with quantity
    await eventModel.collection().updateOne(
      { _id: new ObjectId(eventId) },
      { $push: { waitlist: { userId: new ObjectId(userId), quantity: qty, registeredAt: new Date() } } }
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
    const qty = reg.quantity || 1;
    // Decrement registrationsCount
    await eventModel.collection().updateOne(
      { _id: new ObjectId(eventId) },
      { $inc: { registrationsCount: -qty } }
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
  let event = await eventModel.getEventById(eventId);
  if (!event || !event.waitlist || event.waitlist.length === 0) return [];

  const allocatedUserIds = [];

  // Allocate as many waitlisted requests as fit in the available capacity
  for (let i = 0; i < event.waitlist.length; i++) {
    const nextUser = event.waitlist[i];
    const userId = nextUser.userId;
    const qty = nextUser.quantity || 1;

    if ((event.registrationsCount || 0) + qty <= event.capacity) {
      // Remove them from event's waitlist array
      await eventModel.collection().updateOne(
        { _id: new ObjectId(eventId) },
        { $pull: { waitlist: { userId: new ObjectId(userId) } } }
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
          { $inc: { registrationsCount: qty } }
        );
        event.registrationsCount = (event.registrationsCount || 0) + qty;
        allocatedUserIds.push(userId.toString());
      }
    }
  }

  return allocatedUserIds;
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

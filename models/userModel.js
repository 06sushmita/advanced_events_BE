const { ObjectId } = require("mongodb");
const { getDB } = require("../config/db");

const COLLECTION = "users";

function collection() {
  return getDB().collection(COLLECTION);
}

async function findByEmail(email) {
  return collection().findOne({ email: email.toLowerCase().trim() });
}

async function findById(id) {
  return collection().findOne({ _id: new ObjectId(id) });
}

/**
 * The very first account created on a fresh database becomes admin;
 * everyone after that is staff. This is a simple, dependency-free way
 * to bootstrap an admin without a separate seeding step — fine for a
 * small internal tool. For multi-org use you'd replace this with an
 * invite system instead.
 */
async function createUser({ name, email, passwordHash, role: requestedRole, interests }) {
  const existingCount = await collection().countDocuments();
  
  // If first user, make admin. Otherwise use requested role (organizer/participant) or default to participant.
  let role = "participant";
  if (existingCount === 0) {
    role = "admin";
  } else if (["organizer", "participant"].includes(requestedRole)) {
    role = requestedRole;
  }

  // Organizers must be approved by admin. Admins and Participants are approved by default.
  const isApproved = role !== "organizer";

  const doc = {
    name,
    email: email.toLowerCase().trim(),
    passwordHash,
    role,
    isApproved,
    interests: Array.isArray(interests) ? interests : [],
    createdAt: new Date(),
  };
  const result = await collection().insertOne(doc);
  return { _id: result.insertedId, ...doc };
}

function toSafeUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

module.exports = { findByEmail, findById, createUser, toSafeUser };

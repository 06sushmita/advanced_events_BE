const { ObjectId } = require("mongodb");
const { getDB } = require("../config/db");

const COLLECTION = "teams";

function collection() {
  return getDB().collection(COLLECTION);
}

async function createTeam({ name, eventId, leaderId, leaderName, leaderEmail }) {
  const doc = {
    name: name.trim(),
    eventId: new ObjectId(eventId),
    leaderId: new ObjectId(leaderId),
    members: [
      { userId: new ObjectId(leaderId), name: leaderName, email: leaderEmail }
    ],
    createdAt: new Date()
  };
  const result = await collection().insertOne(doc);
  return { _id: result.insertedId, ...doc };
}

async function getTeamById(id) {
  try {
    return await collection().findOne({ _id: new ObjectId(id) });
  } catch {
    return null;
  }
}

async function addMember(teamId, { userId, name, email }) {
  const team = await getTeamById(teamId);
  if (!team) throw new Error("Team not found.");

  const isMember = team.members.some(m => m.userId.toString() === userId.toString());
  if (isMember) throw new Error("User is already a member of this team.");

  await collection().updateOne(
    { _id: new ObjectId(teamId) },
    { $push: { members: { userId: new ObjectId(userId), name, email } } }
  );

  return getTeamById(teamId);
}

async function getTeamByEventAndUser(eventId, userId) {
  return await collection().findOne({
    eventId: new ObjectId(eventId),
    "members.userId": new ObjectId(userId)
  });
}

module.exports = {
  createTeam,
  addMember,
  getTeamById,
  getTeamByEventAndUser,
  collection
};

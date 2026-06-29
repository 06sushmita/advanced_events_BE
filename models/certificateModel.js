const { ObjectId } = require("mongodb");
const { getDB } = require("../config/db");
const crypto = require("crypto");

const COLLECTION = "certificates";

function collection() {
  return getDB().collection(COLLECTION);
}

async function issueCertificate(userId, eventId) {
  // Check if already exists
  const existing = await collection().findOne({
    userId: new ObjectId(userId),
    eventId: new ObjectId(eventId)
  });
  if (existing) return existing;

  const certificateCode = "CERT-" + crypto.randomBytes(6).toString("hex").toUpperCase();

  const doc = {
    userId: new ObjectId(userId),
    eventId: new ObjectId(eventId),
    certificateCode,
    issuedAt: new Date(),
  };

  const result = await collection().insertOne(doc);
  return { _id: result.insertedId, ...doc };
}

async function getUserCertificates(userId) {
  const list = await collection().find({ userId: new ObjectId(userId) }).toArray();
  const eventIds = list.map(c => c.eventId);

  const events = await getDB().collection("events").find({ _id: { $in: eventIds } }).toArray();
  const eventMap = events.reduce((acc, e) => {
    acc[e._id.toString()] = e;
    return acc;
  }, {});

  return list.map(c => ({
    ...c,
    event: eventMap[c.eventId.toString()] || null
  }));
}

async function verifyCertificate(code) {
  const cert = await collection().findOne({ certificateCode: code.toUpperCase().trim() });
  if (!cert) return null;

  const user = await getDB().collection("users").findOne({ _id: cert.userId });
  const event = await getDB().collection("events").findOne({ _id: cert.eventId });

  return {
    certificateCode: cert.certificateCode,
    issuedAt: cert.issuedAt,
    recipient: user ? user.name : "Unknown",
    eventTitle: event ? event.title : "Unknown Event",
  };
}

module.exports = {
  issueCertificate,
  getUserCertificates,
  verifyCertificate,
  collection,
};

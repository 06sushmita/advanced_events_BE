const test = require("node:test");
const assert = require("node:assert");
const jwt = require("jsonwebtoken");
const { ObjectId } = require("mongodb");

// Mocking getDB and mongo collection behavior
const mockDb = {
  collectionName: "",
  updatedDocs: [],
  insertedDocs: [],
  reset() {
    this.updatedDocs = [];
    this.insertedDocs = [];
  }
};

// We will mock require("../config/db") and the db.collection calls in the test env.
// For simplicity, let's test check-in token validation behavior directly.
test("check-in token signature and validation", (t) => {
  const SECRET = "test-secret";
  process.env.JWT_SECRET = SECRET;

  const payload = { userId: "60b9f0f9c9e77c001f3e792b", eventId: "60b9f0f9c9e77c001f3e792c", type: "checkin" };
  const token = jwt.sign(payload, SECRET, { expiresIn: "24h" });

  // Validate the token decoder logic
  const decoded = jwt.verify(token, SECRET);
  assert.strictEqual(decoded.userId, payload.userId);
  assert.strictEqual(decoded.eventId, payload.eventId);
  assert.strictEqual(decoded.type, "checkin");
});

test("check-in token fails verification with bad secret", (t) => {
  const SECRET = "test-secret";
  const BAD_SECRET = "bad-secret";
  const payload = { userId: "60b9f0f9c9e77c001f3e792b", eventId: "60b9f0f9c9e77c001f3e792c", type: "checkin" };
  const token = jwt.sign(payload, SECRET, { expiresIn: "24h" });

  assert.throws(() => {
    jwt.verify(token, BAD_SECRET);
  });
});

test("check-in token fails if expired", (t) => {
  const SECRET = "test-secret";
  const payload = { userId: "60b9f0f9c9e77c001f3e792b", eventId: "60b9f0f9c9e77c001f3e792c", type: "checkin" };
  // Generate an instantly expired token
  const token = jwt.sign(payload, SECRET, { expiresIn: "0s" });

  assert.throws(() => {
    jwt.verify(token, SECRET);
  });
});

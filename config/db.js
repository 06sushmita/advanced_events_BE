const { MongoClient } = require("mongodb");

const uri = process.env.MONGO_URI;
const dbName = process.env.DB_NAME || "project1";

if (!uri) {
  throw new Error(
    "MONGO_URI is not set. Copy backend/.env.example to backend/.env and fill in your connection string."
  );
}

const client = new MongoClient(uri);

let db = null;

/**
 * Connects once and reuses the same pooled client for every request.
 * The previous version opened a brand new MongoClient on every single
 * request and closed it again afterwards — that is slow (a fresh TCP +
 * TLS handshake per call) and is not how the driver is meant to be used.
 */
async function connectDB() {
  if (db) return db;
  await client.connect();
  db = client.db(dbName);
  console.log(`Connected to MongoDB database: "${dbName}"`);
  return db;
}

function getDB() {
  if (!db) {
    throw new Error("Database not initialized yet. Call connectDB() before getDB().");
  }
  return db;
}

async function closeDB() {
  await client.close();
}

module.exports = { connectDB, getDB, closeDB };

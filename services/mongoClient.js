const { MongoClient } = require('mongodb');

const DB_NAME = process.env.MONGODB_DB || 'japanese_n5';

let client = null;
let db = null;
let connecting = null;

async function connect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return false;

  if (db) return true;
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      client = new MongoClient(uri);
      await client.connect();
      db = client.db(DB_NAME);
      await db.collection('conversations').createIndex({ updatedAt: -1 });
      await db.collection('vector_chunks').createIndex({ chunkId: 1 }, { unique: true });
      await db.collection('vector_chunks').createIndex({ lesson: 1, type: 1 });
      console.log('✓ MongoDB connected:', DB_NAME);
      return true;
    } catch (e) {
      console.warn('✗ MongoDB connection failed:', e.message);
      client = null;
      db = null;
      return false;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

function isConnected() {
  return !!db;
}

function getDb() {
  return db;
}

async function close() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

module.exports = { connect, isConnected, getDb, close, DB_NAME };

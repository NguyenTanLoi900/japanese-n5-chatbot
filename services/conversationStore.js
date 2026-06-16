const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongo = require('./mongoClient');

const CONV_DIR = path.join(__dirname, '..', 'data', 'conversations');

function ensureDir() {
  if (!fs.existsSync(CONV_DIR)) fs.mkdirSync(CONV_DIR, { recursive: true });
}

function filePath(id) {
  return path.join(CONV_DIR, `${id}.json`);
}

function newConvDoc(title) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: (title || 'Cuộc trò chuyện mới').slice(0, 80),
    createdAt: now,
    updatedAt: now,
    messages: [],
    geminiHistory: []
  };
}

function toListItem(c) {
  return {
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    messageCount: (c.messages || []).length
  };
}

class ConversationStore {
  async create(title = 'Cuộc trò chuyện mới') {
    const conv = newConvDoc(title);
    if (mongo.isConnected()) {
      await mongo.getDb().collection('conversations').insertOne(conv);
      return conv;
    }
    ensureDir();
    fs.writeFileSync(filePath(conv.id), JSON.stringify(conv, null, 2), 'utf8');
    return conv;
  }

  async get(id) {
    if (mongo.isConnected()) {
      return mongo.getDb().collection('conversations').findOne({ id });
    }
    const fp = filePath(id);
    if (!fs.existsSync(fp)) return null;
    try {
      return JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch {
      return null;
    }
  }

  async save(conv) {
    conv.updatedAt = new Date().toISOString();
    if (mongo.isConnected()) {
      await mongo.getDb().collection('conversations').updateOne(
        { id: conv.id },
        { $set: conv },
        { upsert: true }
      );
      return conv;
    }
    ensureDir();
    fs.writeFileSync(filePath(conv.id), JSON.stringify(conv, null, 2), 'utf8');
    return conv;
  }

  async list() {
    if (mongo.isConnected()) {
      const rows = await mongo
        .getDb()
        .collection('conversations')
        .find({})
        .sort({ updatedAt: -1 })
        .toArray();
      return rows.map(toListItem);
    }

    ensureDir();
    const files = fs.readdirSync(CONV_DIR).filter((f) => f.endsWith('.json'));
    const convs = files
      .map((f) => {
        try {
          const c = JSON.parse(fs.readFileSync(path.join(CONV_DIR, f), 'utf8'));
          return toListItem(c);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    convs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return convs;
  }

  async addMessage(id, message) {
    const conv = await this.get(id);
    if (!conv) return null;
    conv.messages.push({
      ...message,
      timestamp: message.timestamp || new Date().toISOString()
    });
    return this.save(conv);
  }

  async setGeminiHistory(id, history) {
    const conv = await this.get(id);
    if (!conv) return null;
    conv.geminiHistory = history;
    return this.save(conv);
  }

  async updateTitle(id, title) {
    const conv = await this.get(id);
    if (!conv) return null;
    conv.title = title.slice(0, 80);
    return this.save(conv);
  }

  async delete(id) {
    if (mongo.isConnected()) {
      await mongo.getDb().collection('conversations').deleteOne({ id });
      return;
    }
    const fp = filePath(id);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }

  /** Migrate file-based conversations into MongoDB */
  async migrateFilesToMongo() {
    if (!mongo.isConnected()) return { migrated: 0 };
    ensureDir();
    const files = fs.readdirSync(CONV_DIR).filter((f) => f.endsWith('.json'));
    let migrated = 0;
    for (const f of files) {
      try {
        const c = JSON.parse(fs.readFileSync(path.join(CONV_DIR, f), 'utf8'));
        if (!c.id) continue;
        const exists = await mongo.getDb().collection('conversations').findOne({ id: c.id });
        if (!exists) {
          await mongo.getDb().collection('conversations').insertOne(c);
          migrated++;
        }
      } catch { /* skip */ }
    }
    return { migrated };
  }
}

module.exports = new ConversationStore();

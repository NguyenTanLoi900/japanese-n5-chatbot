const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const fs = require('fs');
const { spawn } = require('child_process');
const mongo = require('../services/mongoClient');
const { buildChunksFromStore } = require('../services/vectorChunks');
const { embedBatch } = require('../services/embeddings'); // Đã bỏ isQuotaError

const FAISS_DIR = path.join(__dirname, '..', 'data', 'faiss');
const VECTORS_FILE = path.join(FAISS_DIR, 'vectors.json');
const BATCH = parseInt(process.env.VECTOR_BUILD_BATCH || '5', 10);
const DELAY_MS = parseInt(process.env.VECTOR_EMBED_DELAY_MS || '100', 10); // Giảm delay vì local rất nhanh

const args = process.argv.slice(2);
const RESUME = args.includes('--resume') || process.env.VECTOR_BUILD_RESUME === '1';
const FAISS_ONLY = args.includes('--faiss-only');

async function buildFaissFromMongo(col) {
  const rows = await col.find({ embedding: { $exists: true } }).toArray();
  if (!rows.length) {
    throw new Error('Không có vector_chunks trong MongoDB. Chạy embed trước.');
  }
  const chunkIds = rows.map((r) => r.chunkId);
  const vectors = rows.map((r) => r.embedding);
  
  fs.mkdirSync(FAISS_DIR, { recursive: true });
  fs.writeFileSync(VECTORS_FILE, JSON.stringify({ chunkIds, vectors }), 'utf8');
  console.log(`Wrote ${VECTORS_FILE} (${rows.length} vectors)`);

  const py = process.env.PYTHON_PATH || 'python';
  await new Promise((resolve, reject) => {
    const child = spawn(py, [path.join(__dirname, '..', 'python', 'build_faiss_index.py')], {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('FAISS build failed'))));
  });
  console.log('✓ FAISS index ready:', path.join(FAISS_DIR, 'index.faiss'));
}

async function main() {
  console.log('Connecting MongoDB...');
  const ok = await mongo.connect();
  if (!ok) {
    console.error('Không thể kết nối MongoDB.');
    process.exit(1);
  }

  const db = mongo.getDb();
  const col = db.collection('vector_chunks');

  if (FAISS_ONLY) {
    await buildFaissFromMongo(col);
    await mongo.close();
    return;
  }

  const chunks = buildChunksFromStore();
  console.log(`Tổng chunks: ${chunks.length}`);

  if (!RESUME) {
    console.log('Chế độ full: xóa vector_chunks cũ...');
    await col.deleteMany({});
  }

  const existingIds = new Set(
    (await col.find({}, { projection: { chunkId: 1 } }).toArray()).map((d) => d.chunkId)
  );

  const pending = chunks.filter((c) => !existingIds.has(c.chunkId));
  console.log(`Cần embed thêm: ${pending.length} chunk`);

  let done = 0;
  try {
    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH);
      const texts = batch.map((c) => c.text);
      console.log(`Embedding ${done + 1}-${done + batch.length} / ${pending.length}...`);
      
      const vectors = await embedBatch(texts, DELAY_MS);

      const docs = batch.map((c, j) => ({
        ...c,
        embedding: vectors[j],
        metadata: {
          ...c.metadata,
          updatedAt: new Date().toISOString()
        }
      }));
+

      await col.insertMany(docs);
      done += batch.length;
    }
  } catch (e) {
    console.error('\n❌ Lỗi khi embedding:', e.message);
    await mongo.close();
    process.exit(1);
  }

  await buildFaissFromMongo(col);
  console.log('Done.');
  await mongo.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

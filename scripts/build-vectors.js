/**
 * Build MongoDB vector_chunks + FAISS index.
 *
 * Usage:
 *   node scripts/build-vectors.js           # full build (xóa cũ, embed lại)
 *   node scripts/build-vectors.js --resume  # tiếp tục chunk chưa có (sau lỗi 429)
 *   node scripts/build-vectors.js --faiss-only  # chỉ tạo FAISS từ MongoDB
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const fs = require('fs');
const { spawn } = require('child_process');
const mongo = require('../services/mongoClient');
const { buildChunksFromStore } = require('../services/vectorChunks');
const { embedBatch, isQuotaError } = require('../services/embeddings');

const FAISS_DIR = path.join(__dirname, '..', 'data', 'faiss');
const VECTORS_FILE = path.join(FAISS_DIR, 'vectors.json');
const BATCH = parseInt(process.env.VECTOR_BUILD_BATCH || '5', 10);
const DELAY_MS = parseInt(process.env.VECTOR_EMBED_DELAY_MS || '500', 10);

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
    console.error('MONGODB_URI chưa cấu hình hoặc không kết nối được.');
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
  } else {
    const existing = await col.countDocuments();
    console.log(`Chế độ --resume: đã có ${existing} chunk trong MongoDB, bỏ qua chunk đã embed.`);
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
      console.log(`Embedding ${done + 1}-${done + batch.length} / ${pending.length} (tổng DB: ${existingIds.size + done})...`);
      const vectors = await embedBatch(texts, DELAY_MS);

      const docs = batch.map((c, j) => {
        const doc = {
          chunkId: c.chunkId,
          type: c.type,
          lesson: c.lesson,
          text: c.text,
          meta: c.meta,
          embedding: vectors[j],
          updatedAt: new Date().toISOString()
        };
        if (c.type === 'vocabulary') {
          doc.id = c.id;
          doc.word = c.word;
          doc.kanji = c.kanji;
          doc.meaning = c.meaning;
          doc.example = c.example;
        } else if (c.type === 'grammar') {
          doc.id = c.id;
          doc.title = c.title;
          doc.pattern = c.pattern;
          doc.explanation = c.explanation;
          doc.examples = c.examples;
        }
        return doc;
      });

      await col.insertMany(docs);
      docs.forEach((d) => existingIds.add(d.chunkId));
      done += batch.length;
    }
  } catch (e) {
    const count = await col.countDocuments();
    console.error('\n❌ Dừng giữa chừng:', e.message);
    if (isQuotaError(e)) {
      console.log(`
📌 Hết quota embed free tier (~1000 request/ngày).
   Đã lưu ${count} chunk trong MongoDB.

   Làm tiếp:
   1) Đợi ~24h HOẶC dùng API key / billing khác
   2) Chạy: npm run build:vectors -- --resume
   3) Tạm dùng FAISS với dữ liệu hiện có:
      npm run build:vectors -- --faiss-only
`);
    }
    if (count > 0) {
      try {
        await buildFaissFromMongo(col);
        console.log('(Đã build FAISS partial từ chunk có sẵn)');
      } catch (fe) {
        console.warn('Không build được FAISS partial:', fe.message);
      }
    }
    await mongo.close();
    process.exit(1);
  }

  await buildFaissFromMongo(col);
  const total = await col.countDocuments();
  console.log('Done. Indexed', total, 'chunks.');
  await mongo.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

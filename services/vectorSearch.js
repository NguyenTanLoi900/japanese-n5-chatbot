const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mongo = require('./mongoClient');
const { embedText } = require('./embeddings');

const FAISS_DIR = path.join(__dirname, '..', 'data', 'faiss');
const INDEX_FILE = path.join(FAISS_DIR, 'index.faiss');
const IDS_FILE = path.join(FAISS_DIR, 'chunk_ids.json');
const PYTHON_SEARCH = path.join(__dirname, '..', 'python', 'faiss_search.py');

function isFaissReady() {
  return fs.existsSync(INDEX_FILE) && fs.existsSync(IDS_FILE);
}

function runPythonSearch(queryVector, topK) {
  return new Promise((resolve, reject) => {
    const py = process.env.PYTHON_PATH || 'python';
    const child = spawn(py, [PYTHON_SEARCH], {
      cwd: path.join(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(err || `Python exit ${code}`));
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(new Error('Invalid JSON from faiss_search: ' + out.slice(0, 200)));
      }
    });
    child.stdin.write(JSON.stringify({ vector: queryVector, topK }));
    child.stdin.end();
  });
}

async function fetchChunksByIds(ids) {
  if (!mongo.isConnected()) return [];
  const db = mongo.getDb();
  const rows = await db
    .collection('vector_chunks')
    .find({ chunkId: { $in: ids } })
    .toArray();
  const map = new Map(rows.map((r) => [r.chunkId, r]));
  return ids.map((id) => map.get(id)).filter(Boolean);
}

async function search(query, options = {}) {
  const { topK = 6, lesson = null, type = null } = options;

  if (!isFaissReady() || !mongo.isConnected()) {
    return { chunks: [], source: 'none' };
  }

  const vector = await embedText(query);
  const raw = await runPythonSearch(vector, Math.min(topK * 3, 20));
  let ids = raw.ids || [];

  let chunks = await fetchChunksByIds(ids);

  if (lesson != null) {
    const lessonNum = parseInt(lesson, 10);
    const inLesson = chunks.filter((c) => c.lesson === lessonNum);
    if (inLesson.length) chunks = inLesson.slice(0, topK);
    else chunks = chunks.slice(0, topK);
  } else {
    chunks = chunks.slice(0, topK);
  }

  if (type) {
    const filtered = chunks.filter((c) => c.type === type);
    if (filtered.length) chunks = filtered;
  }

  return { chunks, source: 'faiss+mongo', scores: raw.scores };
}

function formatChunksForRAG(chunks) {
  if (!chunks.length) return '';
  let ctx = '\n### Kết quả tìm kiếm ngữ nghĩa (FAISS + MongoDB):\n';
  chunks.forEach((c) => {
    ctx += `\n[${c.type === 'grammar' ? 'Ngữ pháp' : 'Từ vựng'} · Bài ${c.lesson}]\n${c.text}\n`;
  });
  return ctx;
}

module.exports = {
  isFaissReady,
  search,
  formatChunksForRAG,
  INDEX_FILE,
  FAISS_DIR
};

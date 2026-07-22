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
  const ids = raw.ids || [];
  const scoreById = new Map(ids.map((id, index) => [id, Number(raw.scores?.[index] ?? 0)]));
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

  // Lightweight reranking: semantic similarity remains dominant, while exact
  // query terms and requested metadata make lesson/type-specific answers stable.
  const terms = String(query || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const uniqueTerms = [...new Set(terms.filter((term) => term.length > 1))];
  const reranked = chunks.map((chunk) => {
    const vectorScore = Math.max(0, Math.min(1, (scoreById.get(chunk.chunkId) + 1) / 2));
    const haystack = String(chunk.text || '').toLowerCase();
    const lexicalScore = uniqueTerms.length
      ? uniqueTerms.filter((term) => haystack.includes(term)).length / uniqueTerms.length
      : 0;
    const lessonMatch = lesson != null && chunk.lesson === parseInt(lesson, 10) ? 1 : 0;
    const typeMatch = type && chunk.type === type ? 1 : 0;
    const bestScore = 0.70 * vectorScore + 0.20 * lexicalScore + 0.07 * lessonMatch + 0.03 * typeMatch;
    return {
      ...chunk,
      retrieval: {
        vectorScore: Number(vectorScore.toFixed(6)),
        lexicalScore: Number(lexicalScore.toFixed(6)),
        lessonMatch,
        typeMatch,
        bestScore: Number(bestScore.toFixed(6))
      }
    };
  }).sort((a, b) => b.retrieval.bestScore - a.retrieval.bestScore).slice(0, topK);

  return {
    chunks: reranked,
    source: 'faiss+mongo+weighted-rerank',
    scores: reranked.map((chunk) => chunk.retrieval.bestScore),
    bestScore: reranked[0]?.retrieval.bestScore ?? null
  };
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

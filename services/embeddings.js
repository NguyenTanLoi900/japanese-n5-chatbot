const { GoogleGenerativeAI } = require('@google/generative-ai');

const DEFAULT_MODEL = 'gemini-embedding-001';

let activeModel = process.env.GEMINI_EMBED_MODEL || DEFAULT_MODEL;

function getEmbedModel(modelName) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY required for embeddings');
  }
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return genAI.getGenerativeModel({ model: modelName || activeModel });
}

function extractValues(result) {
  const emb = result?.embedding;
  if (emb?.values?.length) return emb.values;
  if (Array.isArray(emb) && emb[0]?.values) return emb[0].values;
  if (result?.embeddings?.[0]?.values) return result.embeddings[0].values;
  return null;
}

function parseRetrySeconds(err) {
  const msg = String(err?.message || err || '');
  const m = msg.match(/retry in ([\d.]+)s/i);
  if (m) return Math.ceil(parseFloat(m[1])) + 2;
  if (err?.status === 429) return 30;
  return null;
}

function isQuotaError(err) {
  return err?.status === 429 || /quota|rate limit|too many requests/i.test(String(err?.message || err));
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function embedText(text, options = {}) {
  const input = String(text || '').trim().slice(0, 8000);
  if (!input) throw new Error('Empty text for embedding');

  const modelName = options.model || activeModel;
  const maxRetries = options.maxRetries ?? parseInt(process.env.EMBED_MAX_RETRIES || '8', 10);
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const model = getEmbedModel(modelName);
      const result = await model.embedContent(input);
      const values = extractValues(result);
      if (!values?.length) throw new Error('Empty embedding vector');
      activeModel = modelName;
      return values;
    } catch (e) {
      lastError = e;
      if (isQuotaError(e) && attempt < maxRetries) {
        const waitSec = parseRetrySeconds(e) || 30;
        process.stdout.write(`\n⏳ Quota/rate limit — chờ ${waitSec}s rồi thử lại (${attempt + 1}/${maxRetries})...\n`);
        await sleep(waitSec * 1000);
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

async function embedBatch(texts, delayMs = 200) {
  const vectors = [];
  for (let i = 0; i < texts.length; i++) {
    vectors.push(await embedText(texts[i]));
    if (delayMs && i < texts.length - 1) {
      await sleep(delayMs);
    }
  }
  return vectors;
}

module.exports = {
  embedText,
  embedBatch,
  MODEL: activeModel,
  isQuotaError,
  parseRetrySeconds
};

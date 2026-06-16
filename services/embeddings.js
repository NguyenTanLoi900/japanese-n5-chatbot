
const axios = require('axios');


const OLLAMA_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_EMBED_MODEL || 'bge-m3';


async function embedText(text, options = {}) {
  const input = String(text || '').trim();
  
  try {
    const response = await axios.post(`${OLLAMA_URL}/api/embed`, {
      model: options.model || MODEL,
      input: input
    }, { timeout: 60000 });

    const data = response.data;
    const embedding = data.embedding || (data.embeddings && data.embeddings[0]);

    if (!embedding || !Array.isArray(embedding)) {
      console.error("Dữ liệu phản hồi từ Ollama không hợp lệ:", data);
      throw new Error('Empty or invalid embedding vector from Ollama');
    }

    return embedding;
  } catch (error) {
    console.error("Lỗi khi kết nối Ollama:", error.message);
    throw error;
  }
}


async function embedBatch(texts, delayMs = 50) {
  const vectors = [];
  for (const text of texts) {
    vectors.push(await embedText(text));
    // Ollama chạy local rất nhanh, không cần delay nhiều như Gemini
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
  }
  return vectors;
}

module.exports = {
  embedText,
  embedBatch,
  MODEL
};
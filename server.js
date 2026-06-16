const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const chatbotService = require('./services/chatbot');
const learningService = require('./services/learningService');
const conversationStore = require('./services/conversationStore');
const mongo = require('./services/mongoClient');
const vectorSearch = require('./services/vectorSearch');
const { store, reload } = require('./services/dataStore');

// Setup logging
const logFile = path.join(__dirname, 'debug.log');
function logError(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}`;
  try {
    fs.appendFileSync(logFile, line + '\n');
  } catch (e) {}
  process.stdout.write(line + '\n');
}

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
const DEBUG_HTTP_LOG = process.env.DEBUG_HTTP_LOG === '1';

app.use((req, res, next) => {
  if (DEBUG_HTTP_LOG) {
    fs.appendFileSync(
      path.join(__dirname, 'all-requests.log'),
      `${new Date().toISOString()} ${req.method} ${req.url}\n`
    );
  }
  if (req.url.startsWith('/api')) {
    process.stdout.write(`${req.method} ${req.url}\n`);
  }
  next();
});
// Routes (API trước static để không bị che)
app.post('/api/chat', async (req, res) => {
  // Kiểm tra API Key có tồn tại không
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ 
      error: 'Thiếu cấu hình GEMINI_API_KEY', 
      details: 'Không tìm thấy GEMINI_API_KEY trong file .env. Vui lòng mở file .env ở thư mục dự án và thêm API Key hợp lệ của bạn.' 
    });
  }

  try {
    logError('Chat request body: ' + JSON.stringify(req.body));
    const { message, conversationId } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    logError('Message received: ' + message + ' conv=' + (conversationId || 'new'));
    const response = await chatbotService.chat(message, conversationId || null);
    logError('Response type: ' + (response && response.type));
    res.json(response);
  } catch (error) {
    logError('CAUGHT ERROR: ' + error.message);
    logError('ERROR STACK: ' + error.stack);
    res.status(500).json({ 
      error: 'Lỗi máy chủ (Internal Server Error)', 
      details: error.message 
    });
  }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  let convCount = 0;
  try {
    const list = await conversationStore.list();
    convCount = list.length;
  } catch { /* ignore */ }
  res.json({
    status: 'OK',
    message: 'Japanese N5 Chatbot is running',
    mongo: mongo.isConnected(),
    faiss: vectorSearch.isFaissReady(),
    conversations: convCount
  });
});

// Get grammar data
app.get('/api/grammar', (req, res) => {
  try {
    res.json(store.grammar);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load grammar data' });
  }
});

// Get vocabulary data
app.get('/api/vocabulary', (req, res) => {
  try {
    res.json(store.vocabulary);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load vocabulary data' });
  }
});

// Search grammar
app.get('/api/grammar/search', (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const query = String(q).toLowerCase();
    const results = store.grammar.filter(g => 
      String(g.pattern || '').toLowerCase().includes(query) ||
      String(g.jpn || '').toLowerCase().includes(query) ||
      String(g.title || '').toLowerCase().includes(query) ||
      String(g.explanation || '').toLowerCase().includes(query)
    );
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to search grammar' });
  }
});

// Search vocabulary
app.get('/api/vocabulary/search', (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const query = String(q).toLowerCase();
    const results = store.vocabulary.filter(v => 
      String(v.word || '').toLowerCase().includes(query) ||
      String(v.hiragana || '').toLowerCase().includes(query) ||
      String(v.meaning || '').toLowerCase().includes(query) ||
      String(v.romaji || '').toLowerCase().includes(query)
    );
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to search vocabulary' });
  }
});

// Get statistics
app.get('/api/stats', (req, res) => {
  try {
    res.json({
      grammarPatterns: store.grammar.length,
      vocabularyWords: store.vocabulary.length,
      totalItems: store.grammar.length + store.vocabulary.length,
      files: store.meta
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

// Reload dataset without restarting server (dev helper)
app.post('/api/reload-data', (req, res) => {
  try {
    const next = reload();
    chatbotService.refreshData(next);
    res.json({ ok: true, meta: next.meta });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reload data' });
  }
});

// ============ CONVERSATIONS ============

app.get('/api/conversations', async (req, res) => {
  try {
    const list = await conversationStore.list();
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/conversations', async (req, res) => {
  try {
    const title = req.body.title || 'Cuộc trò chuyện mới';
    const conv = await conversationStore.create(title);
    res.status(201).json(conv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/conversations/:id', async (req, res) => {
  try {
    const conv = await conversationStore.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    res.json(conv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/conversations/:id', async (req, res) => {
  try {
    await conversationStore.delete(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ LEARNING FEATURES ============

// Get available lessons
app.get('/api/lessons', (req, res) => {
  try {
    const lessons = learningService.getAvailableLessons();
    res.json(lessons);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get vocabulary list by lesson
app.get('/api/vocabulary/lesson/:lesson', (req, res) => {
  try {
    const { lesson } = req.params;
    const vocab = learningService.getVocabularyByLesson(lesson);
    res.json(vocab);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get grammar list by lesson
app.get('/api/grammar/lesson/:lesson', (req, res) => {
  try {
    const { lesson } = req.params;
    const gram = learningService.getGrammarByLesson(lesson);
    res.json(gram);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Generate vocabulary quiz for a lesson
app.get('/api/quiz/vocabulary/:lesson', (req, res) => {
  try {
    const { lesson } = req.params;
    const { count } = req.query;
    const quiz = learningService.generateVocabularyQuiz(lesson, count ? parseInt(count) : 10);
    res.json(quiz);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Generate grammar quiz for a lesson
app.get('/api/quiz/grammar/:lesson', (req, res) => {
  try {
    const { lesson } = req.params;
    const { count } = req.query;
    const quiz = learningService.generateGrammarQuiz(lesson, count ? parseInt(count) : 8);
    res.json(quiz);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get vocabulary flashcards for a lesson
app.get('/api/flashcards/vocabulary/:lesson', (req, res) => {
  try {
    const { lesson } = req.params;
    const cards = learningService.getVocabularyFlashcards(lesson);
    res.json(cards);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get grammar flashcards for a lesson
app.get('/api/flashcards/grammar/:lesson', (req, res) => {
  try {
    const { lesson } = req.params;
    const cards = learningService.getGrammarFlashcards(lesson);
    res.json(cards);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Check quiz answers
app.post('/api/quiz/check', (req, res) => {
  try {
    const { answers } = req.body;
    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({ error: 'answers array is required' });
    }
    const result = learningService.checkQuizAnswers(null, answers);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.use(express.static('public'));

async function startServer() {
  const mongoOk = await mongo.connect();
  if (mongoOk) {
    const { migrated } = await conversationStore.migrateFilesToMongo();
    if (migrated > 0) console.log(`Migrated ${migrated} conversations from files → MongoDB`);
  } else {
    console.log('MongoDB: not configured — conversations saved to data/conversations/');
  }
  if (vectorSearch.isFaissReady()) {
    console.log('FAISS vector index: ready');
  } else {
    console.log('FAISS: not built — run: npm run build:vectors');
  }

  app.listen(PORT, () => {
    console.log(`\n🎌 Japanese N5 Chatbot Server`);
    console.log(`==========================================`);
    console.log(`Server running on: http://localhost:${PORT}`);
    console.log(`Web Interface: http://localhost:${PORT}/index.html`);
    console.log(`MongoDB: ${mongo.isConnected() ? 'connected' : 'file fallback'}`);
    console.log(`==========================================\n`);
  });
}

startServer().catch((e) => {
  console.error('Failed to start:', e);
  process.exit(1);
});

module.exports = app;

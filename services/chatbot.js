const { GoogleGenerativeAI } = require('@google/generative-ai');
const { store } = require('./dataStore');
const learningService = require('./learningService');
const conversationStore = require('./conversationStore');
const vectorSearch = require('./vectorSearch');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

let grammarData = store.grammar;
let vocabularyData = store.vocabulary;

const SYSTEM_PROMPT = `Bạn là một trợ lý giảng dạy tiếng Nhật N5 thân thiện và khuyến khích. Vai trò của bạn là giúp người dùng học tiếng Nhật ở mức độ N5 sơ cấp (chương trình Minna no Nihongo).

Bạn có quyền truy cập vào dữ liệu ngữ pháp N5 và từ vựng của Minna no Nihongo (Bài 1–25).

Khi người dùng hỏi về:
- Ngữ pháp: Giải thích cấu trúc một cách rõ ràng với nhiều ví dụ
- Từ vựng: Cung cấp từ, hiragana, romaji, ý nghĩa, và ví dụ sử dụng
- Câu hỏi chung: Cung cấp phản hồi giáo dục về ngôn ngữ và văn hóa Nhật Bản
- Bài học: Tuân theo cấu trúc chương trình Minna no Nihongo

Luôn luôn:
1. Khuyến khích và hỗ trợ người học
2. Sử dụng tiếng Nhật và tiếng Việt trong các phản hồi của bạn khi thích hợp
3. Cung cấp giải thích rõ ràng với nhiều ví dụ
4. Hướng dẫn phát âm bằng hiragana, romaji hoặc kanji nếu cần
5. Đặt các câu hỏi tiếp theo để giúp người học tốt hơn
6. Tập trung vào nội dung N5 (tiếng Nhật sơ cấp)
7. Tham chiếu tài liệu bài học khi liên quan
8. Mừng rỡ tiến bộ của người học

QUAN TRỌNG về ngữ cảnh bài học:
- Chỉ dùng và trích dẫn dữ liệu từ ĐÚNG bài học được nêu trong câu hỏi hoặc trong khối "Dữ liệu tham khảo".
- Nếu người dùng hỏi Bài 15, KHÔNG đưa ví dụ từ Bài 1 hay bài khác trừ khi họ yêu cầu so sánh.
- Nếu không chắc, hãy nói rõ và hỏi lại bài học.

Định dạng phản hồi:
- Bắt đầu với một giải thích ngắn gọn bằng tiếng Việt
- Cung cấp ví dụ tiếng Nhật với hiragana/furigana
- Bao gồm bản dịch tiếng Việt
- Kết thúc bằng một lời khuyến khích hoặc câu hỏi

Nếu câu hỏi có liên quan một bài cụ thể, hãy nhắc "Bài X" trong câu trả lời.
`;

class ChatbotService {
  constructor() {
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    console.log('Initializing ChatbotService with model:', modelName);
    console.log('GEMINI_API_KEY exists:', !!process.env.GEMINI_API_KEY);

    try {
      this.model = genAI.getGenerativeModel({ model: modelName });
      console.log('✓ Model initialized successfully');
    } catch (e) {
      console.error('✗ Error initializing model:', e.message);
      throw e;
    }
  }

  /** Parse "bài 15" / "lesson 3" — avoids matching "1" inside "15" */
  parseLessonNumber(message) {
    const m = message.match(/(?:bài|lesson)\s*(\d{1,2})\b/i);
    return m ? parseInt(m[1], 10) : null;
  }

  parseContentFocus(message) {
    const msg = message.toLowerCase();
    const isGrammar = /ngữ pháp|grammar|文法/.test(msg);
    const isVocab = /từ vựng|từ mới|vocab|単語/.test(msg);
    if (isGrammar && !isVocab) return 'grammar';
    if (isVocab && !isGrammar) return 'vocabulary';
    return null;
  }

  grammarLessonMatches(g, lessonNum) {
    const n = parseInt(g.lesson, 10);
    return !Number.isNaN(n) && n === lessonNum;
  }

  vocabLessonMatches(v, lessonNum) {
    const key = `Minna ${lessonNum}`;
    return v.lesson === key || String(v.lesson || '').replace(/^Minna\s*/i, '') === String(lessonNum);
  }

  scoreGrammarKeyword(g, searchText) {
    const hay = [
      g.pattern, g.jpn, g.title, g.explanation, g.meaning_vi, g.usage_vi,
      ...(g.keywords || [])
    ].join(' ').toLowerCase();
    const words = searchText.split(/\s+/).filter((w) => w.length > 1 && !/^(bài|lesson|ngữ|pháp|từ|vựng|\d+)$/.test(w));
    if (!words.length) return 0;
    return words.filter((w) => hay.includes(w)).length;
  }

  getGrammarForLesson(lessonNum, limit = 8) {
    return grammarData.filter((g) => this.grammarLessonMatches(g, lessonNum)).slice(0, limit);
  }

  getVocabForLesson(lessonNum, limit = 8) {
    return vocabularyData.filter((v) => this.vocabLessonMatches(v, lessonNum)).slice(0, limit);
  }

  findRelevantGrammar(message, lessonNum, focus) {
    if (lessonNum != null && (focus === 'grammar' || focus === null)) {
      const inLesson = this.getGrammarForLesson(lessonNum, 12);
      if (inLesson.length) {
        const searchText = message.toLowerCase().replace(/bài\s*\d+|lesson\s*\d+/gi, '').trim();
        if (searchText.length > 2) {
          return [...inLesson].sort((a, b) => this.scoreGrammarKeyword(b, searchText) - this.scoreGrammarKeyword(a, searchText)).slice(0, 6);
        }
        return inLesson.slice(0, 6);
      }
    }

    const searchText = message.toLowerCase().replace(/bài\s*\d+|lesson\s*\d+/gi, '').trim();
    if (searchText.length < 2) return [];

    return grammarData
      .map((g) => ({ g, score: this.scoreGrammarKeyword(g, searchText) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((x) => x.g);
  }

  findRelevantVocabulary(message, lessonNum, focus) {
    if (lessonNum != null && (focus === 'vocabulary' || focus === null)) {
      const inLesson = this.getVocabForLesson(lessonNum, 12);
      if (inLesson.length) {
        const q = message.toLowerCase();
        const filtered = inLesson.filter((v) =>
          String(v.word || '').toLowerCase().includes(q) ||
          String(v.meaning || '').toLowerCase().includes(q) ||
          String(v.romaji || '').toLowerCase().includes(q) ||
          q.length < 8
        );
        return (filtered.length ? filtered : inLesson).slice(0, 6);
      }
    }

    const q = message.toLowerCase();
    return vocabularyData
      .filter((v) =>
        String(v.word || '').toLowerCase().includes(q) ||
        String(v.meaning || '').toLowerCase().includes(q) ||
        String(v.romaji || '').toLowerCase().includes(q) ||
        String(v.hiragana || '').toLowerCase().includes(q)
      )
      .slice(0, 4);
  }

  async buildRAGContext(message) {
    const lessonNum = this.parseLessonNumber(message);
    const focus = this.parseContentFocus(message);

    let context = '';

    if (lessonNum != null) {
      context += `\n### Ngữ cảnh bài học: Bài ${lessonNum} (CHỈ dùng dữ liệu bài này)\n`;
    }

    try {
      const { chunks } = await vectorSearch.search(message, {
        topK: 6,
        lesson: lessonNum,
        type: focus === 'grammar' ? 'grammar' : focus === 'vocabulary' ? 'vocabulary' : null
      });
      if (chunks.length) {
        context += vectorSearch.formatChunksForRAG(chunks);
      }
    } catch (e) {
      process.stdout.write('Vector search skipped: ' + e.message + '\n');
    }

    const grammarMatches = this.findRelevantGrammar(message, lessonNum, focus);
    const vocabMatches = this.findRelevantVocabulary(message, lessonNum, focus);

    if (grammarMatches.length > 0) {
      context += '\n### Ngữ pháp tham khảo:\n';
      grammarMatches.forEach((g) => {
        const lessonLabel = g.lesson != null ? ` [Bài ${g.lesson}]` : '';
        context += `\n- **${g.pattern}** (${g.jpn})${lessonLabel}: ${g.explanation}\n`;
        if (Array.isArray(g.examples)) {
          g.examples.slice(0, 3).forEach((ex) => {
            const tr = ex.vi || ex.en || '';
            context += `  - JP: ${ex.jp}\n    VI: ${tr}\n`;
          });
        }
      });
    }

    if (vocabMatches.length > 0) {
      context += '\n### Từ vựng tham khảo:\n';
      vocabMatches.forEach((v) => {
        const lessonLabel = v.lesson ? ` [${v.lesson}]` : '';
        context += `\n- **${v.word}** (${v.hiragana}/${v.romaji})${lessonLabel}: ${v.meaning} [${v.pos}]\n`;
        if (v.example && v.example.jp) {
          const tr = v.example.vi || v.example.en || '';
          context += `  Ví dụ: ${v.example.jp} → ${tr}\n`;
        }
      });
    }

    if (!grammarMatches.length && !vocabMatches.length && lessonNum != null) {
      context += `\n(Không tìm thấy dữ liệu chi tiết cho Bài ${lessonNum} — hãy trả lời dựa trên kiến thức N5 chung.)\n`;
    }

    return context;
  }

  normalizeMessage(message) {
    return String(message || '')
      .toLowerCase()
      .replace(/\bquix\b|\bquizz\b|\bqui+\b/g, 'quiz')
      .replace(/từ\s*bựng|từ\s*bung|tu\s*vung|từ\s*vựn/g, 'từ vựng')
      .replace(/\btrac\s*nghiem\b/g, 'trắc nghiệm')
      .replace(/\bbai\s*(\d+)/g, 'bài $1')
      .trim();
  }

  parseLessonFromText(text) {
    const m = String(text || '').match(/(?:bài|lesson)\s*(\d{1,2})\b/i);
    return m ? m[1] : null;
  }

  findLessonInHistory(messages) {
    if (!Array.isArray(messages)) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== 'user') continue;
      const lesson = this.parseLessonFromText(this.normalizeMessage(m.content || ''));
      if (lesson) return lesson;
    }
    return null;
  }

  detectRequestType(message, conversationMessages = []) {
    const msg = this.normalizeMessage(message);
    let lesson = this.parseLessonFromText(msg);
    if (!lesson) lesson = this.findLessonInHistory(conversationMessages);

    const isGrammar = /ngữ pháp|grammar|文法/.test(msg);
    const isVocab = /từ vựng|từ mới|vocab|単語/.test(msg);
    let category = 'vocabulary';
    if (isGrammar && !isVocab) category = 'grammar';
    else if (isVocab) category = 'vocabulary';

    const wantsQuiz =
      /\bquiz\b|trắc nghiệm/.test(msg) ||
      /(tạo|làm|cho|bắt đầu|luyện|ôn).*(quiz|trắc nghiệm)/.test(msg);

    const wantsFlashcard =
      /flashcard|thẻ học|\bthẻ\b/.test(msg) ||
      /(tạo|xem|cho|ôn).*(flashcard|thẻ)/.test(msg);

    const wantsLesson =
      /danh sách|nội dung|list/.test(msg) ||
      (/(xem|hiển thị|cho xem).*(từ vựng|ngữ pháp|bài)/.test(msg) && lesson) ||
      ((isVocab || isGrammar) && lesson && !wantsQuiz && !wantsFlashcard);

    if (wantsQuiz && !lesson) {
      return { type: 'need_lesson', intent: 'quiz', category };
    }
    if (wantsFlashcard && !lesson) {
      return { type: 'need_lesson', intent: 'flashcard', category };
    }

    if (wantsQuiz && lesson) return { type: 'quiz', category, lesson };
    if (wantsFlashcard && lesson) return { type: 'flashcard', category, lesson };
    if (wantsLesson && lesson) return { type: 'lesson', category, lesson };

    return null;
  }

  buildIntroForRequest(req) {
    const cat = req.category === 'vocabulary' ? 'từ vựng' : 'ngữ pháp';
    const n = req.lesson;
    if (req.type === 'quiz') return `📝 Quiz ${cat} Bài ${n} — chọn đáp án đúng cho từng câu nhé!`;
    if (req.type === 'flashcard') return `🎴 Flashcards ${cat} Bài ${n} — bấm thẻ để lật xem nghĩa.`;
    if (req.type === 'lesson') return `📚 Danh sách ${cat} Bài ${n}:`;
    return '';
  }

  handleSpecialRequest(requestType) {
    try {
      if (!requestType.lesson) {
        return { type: 'error', message: 'Vui lòng chỉ định bài học (ví dụ: "quiz từ vựng bài 1")' };
      }

      if (requestType.type === 'quiz') {
        const count = requestType.category === 'vocabulary' ? 10 : 8;
        return requestType.category === 'vocabulary'
          ? learningService.generateVocabularyQuiz(requestType.lesson, count)
          : learningService.generateGrammarQuiz(requestType.lesson, count);
      }

      if (requestType.type === 'flashcard') {
        return requestType.category === 'vocabulary'
          ? learningService.getVocabularyFlashcards(requestType.lesson)
          : learningService.getGrammarFlashcards(requestType.lesson);
      }

      if (requestType.type === 'lesson') {
        return requestType.category === 'vocabulary'
          ? learningService.getVocabularyByLesson(requestType.lesson)
          : learningService.getGrammarByLesson(requestType.lesson);
      }
    } catch (error) {
      return { type: 'error', message: error.message };
    }
  }

  async getOrCreateConversation(conversationId, firstMessage) {
    if (conversationId) {
      const existing = await conversationStore.get(conversationId);
      if (existing) return existing;
    }
    const title = (firstMessage || 'Cuộc trò chuyện mới').slice(0, 48);
    return conversationStore.create(title);
  }

  async chat(userMessage, conversationId = null) {
    const conv = await this.getOrCreateConversation(conversationId, userMessage);
    const convId = conv.id;

    await conversationStore.addMessage(convId, { role: 'user', type: 'text', content: userMessage });

    const special = this.detectRequestType(userMessage, conv.messages);
    if (special?.type === 'need_lesson') {
      const hint =
        special.intent === 'quiz'
          ? '📝 Để tạo quiz, hãy ghi rõ bài số mấy.\nVí dụ: "tạo quiz từ vựng bài 18" hoặc "quiz ngữ pháp bài 5"'
          : '🎴 Để tạo flashcards, hãy ghi rõ bài.\nVí dụ: "flashcard bài 14"';
      await conversationStore.addMessage(convId, { role: 'assistant', type: 'text', content: hint });
      return { type: 'text', text: hint, conversationId: convId };
    }
    if (special) {
      const data = this.handleSpecialRequest(special);
      if (data && data.type === 'error') {
        const errResp = { type: 'error', message: data.message, conversationId: convId };
        await conversationStore.addMessage(convId, { role: 'assistant', type: 'error', content: data.message });
        return errResp;
      }
      const response = {
        type: special.type,
        category: special.category,
        lesson: special.lesson,
        intro: this.buildIntroForRequest(special),
        data,
        conversationId: convId
      };
      await conversationStore.addMessage(convId, {
        role: 'assistant',
        type: special.type,
        content: response.intro,
        category: special.category,
        lesson: special.lesson,
        data
      });
      return response;
    }

    try {
      const ragContext = await this.buildRAGContext(userMessage);
      const lessonNum = this.parseLessonNumber(userMessage);

      const systemBlock = `${SYSTEM_PROMPT}\n\n--- Dữ liệu tham khảo (ưu tiên đúng bài học) ---${ragContext}`;

      const history = conv.geminiHistory || [];
      const contents = [
        { role: 'user', parts: [{ text: systemBlock }] },
        { role: 'model', parts: [{ text: 'Đã hiểu. Tôi sẽ chỉ dùng dữ liệu đúng bài học được cung cấp và trả lời bằng tiếng Việt + tiếng Nhật.' }] },
        ...history,
        { role: 'user', parts: [{ text: userMessage }] }
      ];

      const response = await this.model.generateContent({ contents });
      const assistantMessage = response.response.text();

      history.push(
        { role: 'user', parts: [{ text: userMessage }] },
        { role: 'model', parts: [{ text: assistantMessage }] }
      );
      const trimmed = history.slice(-20);
      await conversationStore.setGeminiHistory(convId, trimmed);

      await conversationStore.addMessage(convId, {
        role: 'assistant',
        type: 'text',
        content: assistantMessage,
        lesson: lessonNum
      });

      const fresh = await conversationStore.get(convId);
      if (fresh && fresh.messages.filter((m) => m.role === 'user').length === 1) {
        const title = userMessage.slice(0, 48) + (userMessage.length > 48 ? '…' : '');
        await conversationStore.updateTitle(convId, title);
      }

      return { type: 'text', text: assistantMessage, conversationId: convId };
    } catch (error) {
      throw new Error('Failed to generate response: ' + error.message);
    }
  }

  getGrammarExplanation(pattern) {
    return grammarData.find((g) =>
      String(g.pattern || '').toLowerCase() === pattern.toLowerCase() ||
      String(g.jpn || '').toLowerCase() === pattern.toLowerCase()
    ) || null;
  }

  getVocabulary(word) {
    return vocabularyData.find((v) =>
      v.word === word ||
      String(v.romaji || '').toLowerCase() === word.toLowerCase() ||
      v.hiragana === word
    ) || null;
  }

  getStats() {
    return {
      grammarPatterns: grammarData.length,
      vocabularyWords: vocabularyData.length,
      lessons: [...new Set(grammarData.map((g) => g.lesson).concat(vocabularyData.map((v) => v.lesson)))]
    };
  }

  refreshData(nextStore) {
    if (!nextStore) return;
    grammarData = nextStore.grammar || grammarData;
    vocabularyData = nextStore.vocabulary || vocabularyData;
  }
}

module.exports = new ChatbotService();

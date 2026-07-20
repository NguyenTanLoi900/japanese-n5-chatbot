const { store } = require('./dataStore');

class LearningService {
  shuffle(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * Get vocabulary list for a specific lesson
   */
  getVocabularyByLesson(lesson) {
    const lessonKey = `Minna ${lesson}`;
    const vocab = store.vocabulary.filter(v => v.lesson === lessonKey);
    
    if (vocab.length === 0) {
      throw new Error(`Không tìm thấy từ vựng cho bài ${lesson}`);
    }
    
    return {
      lesson,
      total: vocab.length,
      items: vocab.map(v => ({
        id: v.id,
        word: v.word,
        hiragana: v.hiragana,
        romaji: v.romaji,
        meaning: v.meaning,
        pos: v.pos,
        example: v.example
      }))
    };
  }

  /**
   * Get grammar list for a specific lesson
   */
  getGrammarByLesson(lesson) {
    const gram = store.grammar.filter(g => g.lesson === parseInt(lesson));
    
    if (gram.length === 0) {
      throw new Error(`Không tìm thấy ngữ pháp cho bài ${lesson}`);
    }
    
    return {
      lesson,
      total: gram.length,
      items: gram.map(g => ({
        grammar_id: g.grammar_id,
        title: g.title,
        grammar: g.grammar,
        meaning_vi: g.meaning_vi,
        usage_vi: g.usage_vi,
        example: g.example,
        keywords: g.keywords
      }))
    };
  }

  /**
   * Generate multiple-choice quiz for vocabulary
   * @param lesson - lesson number
   * @param count - number of questions (default 10)
   */
  generateVocabularyQuiz(lesson, count = 10) {
    return this.generateVocabularyQuizRange(lesson, lesson, count);
  }

  /** Generate a vocabulary quiz from one lesson or an inclusive lesson range. */
  generateVocabularyQuizRange(lessonFrom, lessonTo = lessonFrom, count = null) {
    const from = parseInt(lessonFrom, 10);
    const to = parseInt(lessonTo, 10);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > 25 || from > to) {
      throw new Error('Khoảng bài phải hợp lệ và nằm trong Bài 1–25');
    }

    const vocab = store.vocabulary.filter((v) => {
      const lesson = parseInt(String(v.lesson || '').replace(/^Minna\s*/i, ''), 10);
      return lesson >= from && lesson <= to;
    });

    if (vocab.length === 0) {
      throw new Error(from === to
        ? `Không tìm thấy từ vựng cho bài ${from}`
        : `Không tìm thấy từ vựng từ bài ${from} đến bài ${to}`);
    }

    // count=null means all vocabulary in the selected lesson range.
    const requestedCount = count == null ? vocab.length : Math.max(parseInt(count, 10) || 0, 0);
    const targets = this.shuffle(vocab).slice(0, Math.min(requestedCount, vocab.length));
    const questions = targets.map((correctWord, index) => {
      const distractors = this.shuffle(
        vocab.filter((word) => word.id !== correctWord.id && word.meaning !== correctWord.meaning)
      ).slice(0, 3);
      const shuffledOptions = this.shuffle([correctWord, ...distractors]).map((word, optionIndex) => ({
        id: String.fromCharCode(97 + optionIndex),
        text: word.meaning
      }));
      const correctId = shuffledOptions.find((option) => option.text === correctWord.meaning).id;

      return {
        questionId: index + 1,
        question: `${correctWord.word} (${correctWord.hiragana}) có nghĩa là gì?`,
        options: shuffledOptions,
        correctAnswer: correctId,
        romaji: correctWord.romaji
      };
    });

    return {
      type: 'vocabulary',
      lesson: from === to ? from : `${from}-${to}`,
      lessonFrom: from,
      lessonTo: to,
      totalQuestions: questions.length,
      questions
    };
  }

  /**
   * Generate multiple-choice quiz for grammar
   * @param lesson - lesson number
   * @param count - number of questions (default 8)
   */
  generateGrammarQuiz(lesson, count = 8) {
    const gram = store.grammar.filter(g => g.lesson === parseInt(lesson));
    
    if (gram.length === 0) {
      throw new Error(`Không tìm thấy ngữ pháp cho bài ${lesson}`);
    }
    
    const actualCount = Math.min(count, gram.length);
    const questions = [];
    const usedIndices = new Set();

    for (let i = 0; i < actualCount; i++) {
      let randomIdx;
      do {
        randomIdx = Math.floor(Math.random() * gram.length);
      } while (usedIndices.has(randomIdx));
      usedIndices.add(randomIdx);

      const correctGram = gram[randomIdx];
      const otherGrams = gram.filter((_, idx) => !usedIndices.has(idx)).slice(0, 3);

      const meaningOf = (g) => g.meaning_vi || g.explanation || g.usage_vi || g.title || '';
      const correctMeaning = meaningOf(correctGram);

      const options = [
        { id: 'a', text: correctMeaning },
        ...otherGrams.map((g, idx) => ({
          id: String.fromCharCode(98 + idx),
          text: meaningOf(g)
        }))
      ].filter((o) => o.text);

      const shuffledOptions = options.sort(() => Math.random() - 0.5);
      const correctId = shuffledOptions.find((o) => o.text === correctMeaning)?.id || 'a';

      const grammarLabel = correctGram.grammar || correctGram.pattern || correctGram.title;
      questions.push({
        questionId: i + 1,
        question: `Ngữ pháp "${grammarLabel}" có nghĩa là gì?`,
        options: shuffledOptions,
        correctAnswer: correctId,
        title: correctGram.title
      });
    }

    return {
      type: 'grammar',
      lesson,
      totalQuestions: questions.length,
      questions
    };
  }

  /**
   * Generate flashcards for vocabulary
   */
  getVocabularyFlashcards(lesson) {
    const lessonKey = `Minna ${lesson}`;
    const vocab = store.vocabulary.filter(v => v.lesson === lessonKey);
    
    if (vocab.length === 0) {
      throw new Error(`Không tìm thấy từ vựng cho bài ${lesson}`);
    }
    
    return {
      type: 'vocabulary',
      lesson,
      totalCards: vocab.length,
      cards: vocab.map((v, idx) => ({
        cardId: idx + 1,
        itemId: v.id || `vocabulary-${lesson}-${idx + 1}`,
        lesson: parseInt(lesson, 10),
        front: {
          word: v.word,
          hiragana: v.hiragana,
          romaji: v.romaji
        },
        back: {
          meaning: v.meaning,
          pos: v.pos,
          example: v.example
        }
      }))
    };
  }

  /**
   * Generate flashcards for grammar
   */
  getGrammarFlashcards(lesson) {
    const gram = store.grammar.filter(g => g.lesson === parseInt(lesson));
    
    if (gram.length === 0) {
      throw new Error(`Không tìm thấy ngữ pháp cho bài ${lesson}`);
    }
    
    return {
      type: 'grammar',
      lesson,
      totalCards: gram.length,
      cards: gram.map((g, idx) => ({
        cardId: idx + 1,
        itemId: g.grammar_id || `grammar-${lesson}-${idx + 1}`,
        lesson: parseInt(lesson, 10),
        front: {
          grammar: g.grammar,
          title: g.title
        },
        back: {
          meaning: g.meaning_vi,
          usage: g.usage_vi,
          example: g.example,
          keywords: g.keywords
        }
      }))
    };
  }

  /**
   * Get available lessons
   */
  getAvailableLessons() {
    const vocabLessons = new Set();
    const grammarLessons = new Set();

    store.vocabulary.forEach(v => {
      const lessonNum = parseInt(v.lesson.replace('Minna ', ''));
      vocabLessons.add(lessonNum);
    });

    store.grammar.forEach(g => {
      grammarLessons.add(g.lesson);
    });

    return {
      vocabularyLessons: Array.from(vocabLessons).sort((a, b) => a - b),
      grammarLessons: Array.from(grammarLessons).sort((a, b) => a - b),
      totalLessons: Math.max(Math.max(...vocabLessons), Math.max(...grammarLessons))
    };
  }

  /**
   * Check quiz answers and calculate score
   */
  checkQuizAnswers(quizType, answers) {
    // answers format: [{ questionId: 1, selectedAnswer: 'a' }, ...]
    let correctCount = 0;
    const results = [];

    answers.forEach(answer => {
      // This would need to be called with the quiz object to verify
      // For now, just structure the response
      results.push({
        questionId: answer.questionId,
        selected: answer.selectedAnswer,
        correct: answer.correctAnswer === answer.selectedAnswer
      });
      
      if (answer.correctAnswer === answer.selectedAnswer) {
        correctCount++;
      }
    });

    return {
      totalQuestions: answers.length,
      correctAnswers: correctCount,
      score: Math.round((correctCount / answers.length) * 100),
      results
    };
  }
}

module.exports = new LearningService();

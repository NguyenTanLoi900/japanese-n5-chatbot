const { store } = require('./dataStore');

function parseVocabLesson(lessonStr) {
  if (!lessonStr) return null;
  const m = String(lessonStr).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function buildChunksFromStore() {
  const chunks = [];

  for (const g of store.grammar) {
    const lesson = parseInt(g.lesson, 10);
    if (Number.isNaN(lesson)) continue;
    const examples = (g.examples || [])
      .slice(0, 3)
      .map((ex) => `${ex.jp} → ${ex.vi || ex.en || ''}`)
      .join(' | ');
    const text = [
      `Ngữ pháp Bài ${lesson}`,
      g.pattern,
      g.jpn,
      g.title,
      g.explanation,
      g.meaning_vi,
      g.usage_vi,
      examples
    ].filter(Boolean).join('\n');

    chunks.push({
      chunkId: `grammar-${lesson}-${g.id || g.grammar_id || g.pattern}`.replace(/[^\w-]/g, '_').slice(0, 120),
      type: 'grammar',
      lesson,
      text,
      // Custom grammar attributes
      id: g.id || g.grammar_id || `grammar-${lesson}-${g.pattern}`,
      title: g.title,
      pattern: g.pattern,
      explanation: g.explanation || g.meaning_vi || '',
      examples: (g.examples || []).map(ex => `${ex.jp} → ${ex.vi || ex.en || ''}`),
      meta: {
        pattern: g.pattern,
        title: g.title,
        jpn: g.jpn,
        explanation: g.explanation
      }
    });
  }

  for (const v of store.vocabulary) {
    const lesson = parseVocabLesson(v.lesson);
    if (lesson == null) continue;
    const ex = v.example
      ? `${v.example.jp || ''} → ${v.example.vi || v.example.en || ''}`
      : '';
    const text = [
      `Từ vựng Bài ${lesson}`,
      v.word,
      v.hiragana,
      v.romaji,
      v.meaning,
      v.pos,
      ex
    ].filter(Boolean).join('\n');

    // Determine Kanji: if word is different from hiragana, then word is Kanji. Otherwise Kanji is empty.
    const kanji = (v.word !== v.hiragana) ? v.word : '';

    chunks.push({
      chunkId: `vocab-${lesson}-${v.id || v.word}`.replace(/[^\w-]/g, '_').slice(0, 120),
      type: 'vocabulary',
      lesson,
      text,
      // Custom vocabulary attributes
      id: v.id || `vocab-${lesson}-${v.word}`,
      word: v.word,
      kanji: kanji,
      meaning: v.meaning || '',
      example: ex,
      meta: {
        word: v.word,
        hiragana: v.hiragana,
        romaji: v.romaji,
        meaning: v.meaning,
        pos: v.pos
      }
    });
  }

  return chunks;
}

module.exports = { buildChunksFromStore };


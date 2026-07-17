const { store } = require('./dataStore');

const DATASET_NAME = 'minna-no-nihongo-n5';
const EMBEDDING_MODEL = process.env.OLLAMA_EMBED_MODEL || 'bge-m3';

function buildMetadata(item) {
  return {
    schemaVersion: 1,
    dataset: DATASET_NAME,
    source: 'local-json',
    sourceFile: item.sourceFile || null,
    jlptLevel: item.jlpt_level || item.level || 'N5',
    language: {
      term: 'ja',
      meaning: 'vi'
    },
    embeddingModel: EMBEDDING_MODEL
  };
}

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
      metadata: buildMetadata(g)
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
      metadata: buildMetadata(v)
    });
  }

  return chunks;
}

module.exports = { buildChunksFromStore };


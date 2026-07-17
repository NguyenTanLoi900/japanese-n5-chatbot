const fs = require('fs');
const path = require('path');

function safeReadJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function listLessonFiles(dirPath, prefix) {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((f) => f.toLowerCase().startsWith(prefix) && f.toLowerCase().endsWith('.json'))
    .map((f) => path.join(dirPath, f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function normalizeGrammarItem(item, sourceFile) {
  const examples = Array.isArray(item.example)
    ? item.example.map((ex) => ({
        jp: ex.jp || '',
        en: ex.en || ex.vi || '',
        vi: ex.vi || ex.en || '',
      }))
    : Array.isArray(item.examples)
      ? item.examples.map((ex) => ({
          jp: ex.jp || '',
          en: ex.en || ex.vi || '',
          vi: ex.vi || ex.en || '',
        }))
      : [];

  return {
    id: item.grammar_id || item.id || undefined,
    lesson: item.lesson ?? item.lessonNumber ?? item.lesson_name ?? undefined,
    title: item.title || item.name || item.pattern || item.grammar || '',
    pattern: item.pattern || item.grammar || item.title || '',
    jpn: item.jpn || item.grammar || item.pattern || '',
    explanation: item.explanation || item.usage_vi || item.meaning_vi || '',
    meaning_vi: item.meaning_vi || undefined,
    usage_vi: item.usage_vi || undefined,
    keywords: item.keywords || [],
    jlpt_level: item.jlpt_level || item.level || 'N5',
    examples,
    sourceFile,
    raw: item,
  };
}

function normalizeVocabItem(item, sourceFile) {
  const example = item.example
    ? {
        jp: item.example.jp || '',
        en: item.example.en || item.example.vi || '',
        vi: item.example.vi || item.example.en || '',
        furigana: item.example.furigana || undefined,
      }
    : undefined;

  return {
    id: item.id || undefined,
    lesson: item.lesson ?? undefined,
    word: item.word || '',
    hiragana: item.hiragana || '',
    romaji: item.romaji || '',
    meaning: item.meaning || item.meaning_vi || '',
    pos: item.pos || item.partOfSpeech || '',
    level: item.level || item.jlpt_level || 'N5',
    example,
    sourceFile,
    raw: item,
  };
}

function loadAllData() {
  const grammarDir = path.join(__dirname, '..', 'data', 'grammar');
  const vocabDir = path.join(__dirname, '..', 'data', 'vocabulary');

  const grammarFiles = listLessonFiles(grammarDir, 'gram_lesson');
  const vocabFiles = listLessonFiles(vocabDir, 'vocab_lesson');

  const grammar = grammarFiles.flatMap((filePath) =>
    safeReadJson(filePath).map((item) => normalizeGrammarItem(item, path.basename(filePath)))
  );

  const vocabulary = vocabFiles.flatMap((filePath) =>
    safeReadJson(filePath).map((item) => normalizeVocabItem(item, path.basename(filePath)))
  );

  return {
    grammar,
    vocabulary,
    meta: {
      grammarFiles: grammarFiles.length,
      vocabularyFiles: vocabFiles.length,
      grammarItems: grammar.length,
      vocabularyItems: vocabulary.length,
    },
  };
}

// Loaded once at startup (simple + fast for this dataset size)
const store = loadAllData();

module.exports = {
  store,
  reload() {
    const next = loadAllData();
    store.grammar = next.grammar;
    store.vocabulary = next.vocabulary;
    store.meta = next.meta;
    return store;
  },
};


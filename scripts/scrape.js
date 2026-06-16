const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

// Robust Kana-to-Romaji converter
function toRomaji(kana) {
  if (!kana) return '';
  const mapping = {
    'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o',
    'か': 'ka', 'き': 'ki', 'く': 'ku', 'け': 'ke', 'こ': 'ko',
    'さ': 'sa', 'し': 'shi', 'す': 'su', 'せ': 'se', 'そ': 'so',
    'た': 'ta', 'ち': 'chi', 'つ': 'tsu', 'て': 'te', 'と': 'to',
    'な': 'na', 'に': 'ni', 'ぬ': 'nu', 'ね': 'ne', 'の': 'no',
    'は': 'ha', 'ひ': 'hi', 'ふ': 'fu', 'へ': 'he', 'ほ': 'ho',
    'ま': 'ma', 'み': 'mi', 'む': 'mu', 'め': 'me', 'も': 'mo',
    'や': 'ya', 'ゆ': 'yu', 'よ': 'yo',
    'ら': 'ra', 'り': 'ri', 'る': 'ru', 'れ': 're', 'ろ': 'ro',
    'わ': 'wa', 'を': 'wo', 'ん': 'n',
    'が': 'ga', 'ぎ': 'gi', 'ぐ': 'gu', 'げ': 'ge', 'ご': 'go',
    'ざ': 'za', 'じ': 'ji', 'ず': 'zu', 'ぜ': 'ze', 'ぞ': 'zo',
    'だ': 'da', 'ぢ': 'ji', 'づ': 'zu', 'で': 'de', 'ど': 'do',
    'ば': 'ba', 'び': 'bi', 'ぶ': 'bu', 'べ': 'be', 'ぼ': 'bo',
    'ぱ': 'pa', 'pi': 'pi', 'ぷ': 'pu', 'ぺ': 'pe', 'ぽ': 'po',
    'ア': 'a', 'イ': 'i', 'ウ': 'u', 'エ': 'e', 'オ': 'o',
    'カ': 'ka', 'キ': 'ki', 'ク': 'ku', 'ケ': 'ke', 'コ': 'ko',
    'サ': 'sa', 'シ': 'shi', 'ス': 'su', 'セ': 'se', 'ソ': 'so',
    'タ': 'ta', 'チ': 'chi', 'ツ': 'tsu', 'テ': 'te', 'ト': 'to',
    'ナ': 'na', 'ニ': 'ni', 'ヌ': 'nu', 'ネ': 'ne', 'ノ': 'no',
    'ハ': 'ha', 'ヒ': 'hi', 'フ': 'fu', 'ヘ': 'he', 'ho': 'ho',
    'マ': 'ma', 'ミ': 'mi', 'ム': 'mu', 'メ': 'me', 'モ': 'mo',
    'ヤ': 'ya', 'ユ': 'yu', 'ヨ': 'yo',
    'ラ': 'ra', 'リ': 'ri', 'ル': 'ru', 'レ': 're', 'ロ': 'ro',
    'ワ': 'wa', 'ヲ': 'wo', 'ン': 'n',
    'ガ': 'ga', 'ギ': 'gi', 'グ': 'gu', 'ゲ': 'ge', 'ゴ': 'go',
    'ザ': 'za', 'ジ': 'ji', 'ズ': 'zu', 'ゼ': 'ze', 'ゾ': 'zo',
    'ダ': 'da', 'ヂ': 'ji', 'ヅ': 'zu', 'デ': 'de', 'ド': 'do',
    'バ': 'ba', 'ビ': 'bi', 'ブ': 'bu', 'ベ': 'be', 'ボ': 'bo',
    'パ': 'pa', 'ピ': 'pi', 'プ': 'pu', 'ペ': 'pe', 'ポ': 'po',
    // Yoon
    'きゃ': 'kya', 'きゅ': 'kyu', 'きょ': 'kyo',
    'しゃ': 'sha', 'しゅ': 'shu', 'しょ': 'sho',
    'ちゃ': 'cha', 'ちゅ': 'chu', 'ちょ': 'cho',
    'にゃ': 'nya', 'にゅ': 'nyu', 'にょ': 'nyo',
    'ひゃ': 'hya', 'ひゅ': 'hyu', 'ひょ': 'hyo',
    'みゃ': 'mya', 'みゅ': 'myu', 'みょ': 'myo',
    'りゃ': 'rya', 'りゅ': 'ryu', 'りょ': 'ryo',
    'ぎゃ': 'gya', 'ぎゅ': 'gyu', 'ぎょ': 'gyo',
    'じゃ': 'ja', 'じゅ': 'ju', 'じょ': 'jo',
    'びゃ': 'bya', 'びゅ': 'byu', 'びょ': 'byo',
    'ぴゃ': 'pya', 'ぴゅ': 'pyu', 'ぴょ': 'pyo',
    'キャ': 'kya', 'キュ': 'kyu', 'キョ': 'kyo',
    'シャ': 'sha', 'シュ': 'shu', 'ショ': 'sho',
    'チャ': 'cha', 'チュ': 'chu', 'チョ': 'cho',
    'ニャ': 'nya', 'ニュ': 'nyu', 'ニョ': 'nyo',
    'ヒャ': 'hya', 'ヒュ': 'hyu', 'ヒょ': 'hyo',
    'ミャ': 'mya', 'ミュ': 'myu', 'ミョ': 'myo',
    'リャ': 'rya', 'リュ': 'ryu', 'リョ': 'ryo',
    'ギャ': 'gya', 'ギュ': 'gyu', 'ギョ': 'gyo',
    'ジャ': 'ja', 'ジュ': 'ju', 'ジョ': 'jo',
    'ビャ': 'bya', 'ビュ': 'byu', 'ビョ': 'byo',
    'ピャ': 'pya', 'ピュ': 'pyu', 'ピョ': 'pyo',
  };

  let result = '';
  let i = 0;
  while (i < kana.length) {
    const c = kana[i];
    const nextC = kana[i + 1];
    
    if (c === 'ー') {
      const lastChar = result[result.length - 1];
      if (['a', 'e', 'i', 'o', 'u'].includes(lastChar)) {
        result += lastChar;
      }
      i++;
      continue;
    }

    if (c === 'っ' || c === 'ッ') {
      if (nextC) {
        const nextChar = mapping[nextC] || mapping[nextC + kana[i + 2]];
        if (nextChar) {
          result += nextChar[0];
        }
      }
      i++;
      continue;
    }

    if (nextC && mapping[c + nextC]) {
      result += mapping[c + nextC];
      i += 2;
    } else if (mapping[c]) {
      result += mapping[c];
      i++;
    } else {
      result += c;
      i++;
    }
  }
  return result;
}

function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\xa0/g, ' ') // Clean &nbsp; unicode spaces
    .replace(/\s+/g, ' ') // Collapse multiple whitespace
    .trim();
}

async function scrape() {
  const lessonUrls = [];
  for (let i = 1; i <= 25; i++) {
    lessonUrls.push(`https://riki.edu.vn/minna-no-nihongo/bai-${i}`);
  }

  const outputVocabDir = path.join(__dirname, "../data/vocabulary");
  const outputGrammarDir = path.join(__dirname, "../data/grammar");

  if (!fs.existsSync(outputVocabDir)) {
    fs.mkdirSync(outputVocabDir, { recursive: true });
  }
  if (!fs.existsSync(outputGrammarDir)) {
    fs.mkdirSync(outputGrammarDir, { recursive: true });
  }

  let totalVocab = 0;
  let totalGrammar = 0;

  for (let lesson = 1; lesson <= lessonUrls.length; lesson++) {
    const url = lessonUrls[lesson - 1];
    console.log(`Đang scrape Bài ${lesson}: ${url}`);

    const lessonVocab = [];
    const lessonGrammar = [];

    try {
      const response = await axios.get(url, { timeout: 15000 });
      const $ = cheerio.load(response.data);

      $("div.box_content_write").each((i, box) => {
        const title = cleanText($(box).find("h2.titleH2").first().text());
        const content = cleanText($(box).find(".pageDetailContent_post").text());

        if (!title) return;

        // Vocabulary section
        if (
          title.toLowerCase().includes("từ vựng") ||
          title.toLowerCase().includes("tu vung")
        ) {
          $(box)
            .find("table tr")
            .each((j, row) => {
              const cols = $(row).find("td");
              if (cols.length >= 3) {
                let stt = '';
                let word = '';
                let kanji = '';
                let meaning = '';

                if (cols.length >= 4) {
                  stt = cleanText($(cols[0]).text());
                  word = cleanText($(cols[1]).text());
                  kanji = cleanText($(cols[2]).text());
                  meaning = cleanText($(cols[3]).text());
                } else {
                  word = cleanText($(cols[0]).text());
                  kanji = cleanText($(cols[1]).text());
                  meaning = cleanText($(cols[2]).text());
                }

                // Skip headers like "STT", "Hiragana", etc.
                if (stt === 'STT' || word.toLowerCase().includes('từ vựng') || word.toLowerCase().includes('hiragana') || meaning.toLowerCase().includes('ý nghĩa')) {
                  return;
                }

                if (word && meaning) {
                  // Normalize Kanji representation: remove &nbsp; and placehold dashes
                  const finalKanji = (kanji && kanji !== ' ' && kanji !== '—' && kanji !== '-') ? kanji : '';
                  // If Kanji is present, set word to Kanji, and hiragana to the kana. Otherwise, word is Hiragana.
                  const finalWord = finalKanji ? finalKanji : word;

                  lessonVocab.push({
                    id: `vocab-${lesson}-${lessonVocab.length + 1}`,
                    lesson: `Minna ${lesson}`,
                    word: finalWord,
                    hiragana: word,
                    romaji: toRomaji(word),
                    meaning: meaning,
                    pos: '',
                    level: 'N5',
                    example: null
                  });
                }
              }
            });
        }
        // Grammar section
        else {
          const examples = [];
          
          // Parse structured examples from tables
          $(box).find("table").each((k, tbl) => {
            if ($(tbl).text().includes("例")) {
              $(tbl).find("tr").each((l, row) => {
                let jpText = "";
                let viText = "";
                
                $(row).find("p").each((pIdx, pEl) => {
                  const pText = cleanText($(pEl).text());
                  if (!pText || pText.startsWith("例")) return;
                  
                  if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(pText)) {
                    const clone = $(pEl).clone();
                    clone.find("ruby").each((rIdx, rubyEl) => {
                      const rtText = cleanText($(rubyEl).find("rt").text());
                      $(rubyEl).find("rt").remove();
                      $(rubyEl).find("rp").remove();
                      const kanjiText = cleanText($(rubyEl).text());
                      $(rubyEl).text(`${kanjiText} (${rtText})`);
                    });
                    jpText = cleanText(clone.text());
                  } else {
                    viText = pText;
                  }
                });
                
                if (jpText && viText) {
                  examples.push({ jp: jpText, vi: viText });
                }
              });
            }
          });

          // Fallback parsing from paragraphs
          if (examples.length === 0) {
            let lastJp = "";
            $(box).find("p").each((pIdx, pEl) => {
              const pText = cleanText($(pEl).text());
              if (!pText || pText.startsWith("例")) return;
              
              if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(pText)) {
                const clone = $(pEl).clone();
                clone.find("ruby").each((rIdx, rubyEl) => {
                  const rtText = cleanText($(rubyEl).find("rt").text());
                  $(rubyEl).find("rt").remove();
                  $(rubyEl).find("rp").remove();
                  const kanjiText = cleanText($(rubyEl).text());
                  $(rubyEl).text(`${kanjiText} (${rtText})`);
                });
                lastJp = cleanText(clone.text());
              } else if (lastJp) {
                examples.push({ jp: lastJp, vi: pText });
                lastJp = "";
              }
            });
          }

          const cleanTitle = title.replace(/^\d+[\s.]*/, '').trim();
          let pattern = cleanTitle;
          let meaning_vi = '';
          if (cleanTitle.includes('==>')) {
            const parts = cleanTitle.split('==>');
            pattern = parts[0].trim();
            meaning_vi = parts[1].trim();
          } else if (cleanTitle.includes('==&gt;')) {
            const parts = cleanTitle.split('==&gt;');
            pattern = parts[0].trim();
            meaning_vi = parts[1].trim();
          } else if (cleanTitle.includes(':')) {
            const parts = cleanTitle.split(':');
            pattern = parts[0].trim();
            meaning_vi = parts[1].trim();
          } else {
            const matches = cleanTitle.match(/(.*?)(\b[a-záàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]+\b.*)/i);
            if (matches && matches.length >= 3) {
              pattern = matches[1].trim();
              meaning_vi = matches[2].trim();
            }
          }

          lessonGrammar.push({
            grammar_id: `grammar-${lesson}-${lessonGrammar.length + 1}`,
            lesson: lesson,
            title: cleanTitle,
            pattern: pattern,
            jpn: pattern,
            explanation: content,
            meaning_vi: meaning_vi || cleanTitle,
            usage_vi: content,
            keywords: [],
            level: 'N5',
            example: examples
          });
        }
      });

      fs.writeFileSync(
        path.join(outputVocabDir, `vocab_lesson_${lesson}.json`),
        JSON.stringify(lessonVocab, null, 2),
        "utf8"
      );

      fs.writeFileSync(
        path.join(outputGrammarDir, `gram_lesson_${lesson}.json`),
        JSON.stringify(lessonGrammar, null, 2),
        "utf8"
      );

      console.log(`Bài ${lesson}: scraped ${lessonVocab.length} từ vựng, ${lessonGrammar.length} ngữ pháp.`);
      totalVocab += lessonVocab.length;
      totalGrammar += lessonGrammar.length;

    } catch (err) {
      console.error(`Lỗi bài ${lesson}:`, err.message);
    }
  }

  console.log("\n==============================");
  console.log(`Tổng từ vựng: ${totalVocab}`);
  console.log(`Tổng ngữ pháp: ${totalGrammar}`);
  console.log("Hoàn tất.");
}

scrape();


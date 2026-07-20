
      /** API base pointing to Node server (port 5000) */
      function getApiBase() {
        const port = window.location.port;
        const host = window.location.hostname || '127.0.0.1';
        if (window.location.protocol === 'file:') {
          return 'http://127.0.0.1:5000/api';
        }
        if (port === '5000' || port === '') {
          return '/api';
        }
        return 'http://' + host + ':5000/api';
      }
      
      const API_BASE = getApiBase();
      const STORAGE_KEY = 'n5-active-conversation';
      const FORGOTTEN_KEY = 'n5-forgotten-items';
      const log = document.getElementById('log');
      const input = document.getElementById('input');
      const sendBtn = document.getElementById('send');
      const attachBtn = document.getElementById('attach');
      const fileInput = document.getElementById('file-input');
      const attachmentPreview = document.getElementById('attachment-preview');
      const attachmentName = document.getElementById('attachment-name');
      const removeAttachmentBtn = document.getElementById('remove-attachment');
      const convListEl = document.getElementById('conv-list');
      const chatTitleEl = document.getElementById('chat-title');
      const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
      const sidebarOverlay = document.getElementById('sidebar-overlay');
      const appEl = document.querySelector('.app');
      const themeToggleInput = document.getElementById('theme-toggle-input');

      let conversationId = localStorage.getItem(STORAGE_KEY) || null;
      let selectedImage = null;
      let widgetId = 0;
      const widgets = new Map();

      // Theme toggle switch implementation
      const currentTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme', currentTheme);
      themeToggleInput.checked = currentTheme === 'dark';

      themeToggleInput.addEventListener('change', () => {
        const newTheme = themeToggleInput.checked ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
      });

      // Health Check button click event
      document.getElementById('btn-health-check').addEventListener('click', () => {
        window.open(API_BASE + '/health', '_blank');
      });

      // Mobile sidebar logic
      if (btnToggleSidebar) {
        btnToggleSidebar.addEventListener('click', () => {
          appEl.classList.toggle('sidebar-open');
        });
      }
      if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', () => {
          appEl.classList.remove('sidebar-open');
        });
      }

      // Fast suggestion sending
      window.sendSuggestion = function(text) {
        input.value = text;
        send();
      };

      function esc(s) {
        const d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
      }

      function scrollLog() { log.scrollTop = log.scrollHeight; }

      function speakJapanese(text) {
        if (!text || !('speechSynthesis' in window)) {
          addBotText('Trình duyệt này chưa hỗ trợ đọc văn bản.');
          return;
        }
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(String(text));
        utterance.lang = 'ja-JP';
        utterance.rate = 0.82;
        window.speechSynthesis.speak(utterance);
      }

      function loadForgottenItems() {
        try {
          const items = JSON.parse(localStorage.getItem(FORGOTTEN_KEY) || '[]');
          return Array.isArray(items) ? items : [];
        } catch { return []; }
      }

      function forgottenItemFromCard(card, type) {
        const front = card.front || {};
        const back = card.back || {};
        return {
          itemId: String(card.itemId || `${type}-${card.lesson || ''}-${card.cardId}`),
          type,
          lesson: card.lesson || null,
          text: type === 'grammar' ? (front.grammar || front.title || '') : (front.word || ''),
          reading: type === 'grammar' ? (front.title || '') : (front.hiragana || ''),
          romaji: type === 'grammar' ? '' : (front.romaji || ''),
          meaning: back.meaning || '',
          savedAt: new Date().toISOString()
        };
      }

      function markCard(card, type, forgotten) {
        const item = forgottenItemFromCard(card, type);
        const items = loadForgottenItems().filter(saved => saved.itemId !== item.itemId);
        if (forgotten) items.unshift(item);
        localStorage.setItem(FORGOTTEN_KEY, JSON.stringify(items));
      }

      function isForgotten(card, type) {
        const itemId = forgottenItemFromCard(card, type).itemId;
        return loadForgottenItems().some(item => item.itemId === itemId);
      }

      function isForgottenRequest(message) {
        const normalized = String(message || '').toLowerCase();
        const mentionsForgotten = /(chưa nhớ|còn chưa nhớ|không nhớ|hay quên|đã quên)/i.test(normalized);
        const mentionsWords = /(từ|từ vựng|flashcard|thẻ|mục|danh sách|luyện|ôn|xem|hiện)/i.test(normalized);
        return mentionsForgotten && mentionsWords;
      }

      function renderForgottenItems() {
        const items = loadForgottenItems();
        addBotWidget(items.length ? `Bạn có ${items.length} mục chưa nhớ.` : '', (_id, body) => {
          if (!items.length) {
            body.innerHTML = '<div class="error-inline">Bạn chưa đánh dấu từ nào là “Chưa nhớ”.</div>';
            return;
          }
          body.innerHTML = '<div class="items-grid">' + items.map(item =>
            '<div class="item"><div class="item-title">' + esc(item.text) +
            (item.reading ? ' (' + esc(item.reading) + ')' : '') + '</div><div>' + esc(item.meaning) +
            (item.lesson ? ' · Bài ' + esc(item.lesson) : '') + '</div><div class="item-actions">' +
            '<button type="button" class="speak-button" data-action="speak" data-text="' + esc(item.text) + '">🔊 Nghe</button>' +
            '<button type="button" class="remembered-button" data-action="forgotten-remove" data-item-id="' + esc(item.itemId) + '">✓ Đã nhớ</button>' +
            '</div></div>'
          ).join('') + '</div>';
        });
      }

      function normalizeJapanese(text) {
        return String(text || '').normalize('NFKC').replace(/[\s、。！？,.!?]/g, '').toLowerCase();
      }

      function levenshtein(a, b) {
        const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
        for (let j = 1; j <= b.length; j++) rows[0][j] = j;
        for (let i = 1; i <= a.length; i++) {
          for (let j = 1; j <= b.length; j++) {
            rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1,
              rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
          }
        }
        return rows[a.length][b.length];
      }

      function pronunciationScore(expected, heard) {
        const a = normalizeJapanese(expected);
        const b = normalizeJapanese(heard);
        if (!a || !b) return 0;
        return Math.max(0, Math.round((1 - levenshtein(a, b) / Math.max(a.length, b.length)) * 100));
      }

      function startPronunciation(text, resultElement) {
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Recognition) {
          resultElement.textContent = 'Trình duyệt chưa hỗ trợ nhận dạng giọng nói. Hãy thử Chrome hoặc Edge.';
          return;
        }
        const recognition = new Recognition();
        recognition.lang = 'ja-JP';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        resultElement.textContent = '🎙️ Đang nghe… hãy đọc: ' + text;
        recognition.onresult = event => {
          const heard = event.results[0][0].transcript;
          const score = pronunciationScore(text, heard);
          const level = score >= 90 ? 'Rất tốt' : score >= 75 ? 'Tốt' : score >= 60 ? 'Cần luyện thêm' : 'Hãy nghe mẫu và thử lại';
          resultElement.innerHTML = '<strong>' + score + '/100 · ' + level + '</strong><br>Máy nghe được: ' + esc(heard);
        };
        recognition.onerror = event => {
          resultElement.textContent = event.error === 'not-allowed'
            ? 'Bạn cần cho phép trình duyệt dùng micro.'
            : 'Không nhận dạng được giọng nói. Hãy thử lại ở nơi yên tĩnh.';
        };
        recognition.start();
      }

      function setConversationId(id) {
        conversationId = id;
        if (id) localStorage.setItem(STORAGE_KEY, id);
        else localStorage.removeItem(STORAGE_KEY);
      }

      function clearLog() {
        log.innerHTML = '';
        widgets.clear();
        widgetId = 0;
      }

      // ... Rest of functions remain identical and unchanged ...
      function addUserMsg(text) {
        const div = document.createElement('div');
        div.className = 'msg user';
        div.innerHTML = `
          <div class="msg-avatar">👤</div>
          <div class="msg-content">
            <div class="msg-label">Bạn</div>
            <div class="msg-bubble">${esc(text)}</div>
          </div>
        `;
        log.appendChild(div);
        scrollLog();
      }

      function addBotText(text) {
        const div = document.createElement('div');
        div.className = 'msg bot text-only';
        div.innerHTML = `
          <div class="msg-avatar">🇯🇵</div>
          <div class="msg-content">
            <div class="msg-label">Bot</div>
            <div class="msg-bubble">${esc(text)}</div>
          </div>
        `;
        log.appendChild(div);
        scrollLog();
      }

      function addBotWidget(intro, renderFn) {
        const id = ++widgetId;
        const div = document.createElement('div');
        div.className = 'msg bot';
        
        let introHtml = '';
        if (intro) {
          introHtml = `<div class="widget-intro">${esc(intro)}</div>`;
        }

        div.innerHTML = `
          <div class="msg-avatar">🇯🇵</div>
          <div class="msg-content">
            <div class="msg-label">Bot</div>
            <div class="msg-bubble">
              ${introHtml}
              <div class="widget-body" data-widget-body></div>
            </div>
          </div>
        `;
        log.appendChild(div);
        renderFn(id, div.querySelector('[data-widget-body]'));
        scrollLog();
        return id;
      }

      function handleResponse(data, skipPersist) {
        if (!data || !data.type) {
          addBotText(data.response || data.text || 'Không có phản hồi.');
          return;
        }
        switch (data.type) {
          case 'text': addBotText(data.text); break;
          case 'error': addBotText('⚠️ ' + (data.message || 'Có lỗi.')); break;
          case 'quiz': renderQuizWidget(data.intro, data.data); break;
          case 'flashcard': renderFlashcardWidget(data.intro, data.data, data.category); break;
          case 'lesson': renderLessonWidget(data.intro, data.data, data.category); break;
          default: addBotText(JSON.stringify(data));
        }
      }

      function replayMessage(msg) {
        if (msg.role === 'user') {
          addUserMsg(msg.content);
          return;
        }
        if (msg.type === 'text' || !msg.type) {
          addBotText(msg.content);
        } else if (msg.type === 'error') {
          addBotText('⚠️ ' + msg.content);
        } else if (msg.type === 'quiz') {
          renderQuizWidget(msg.content, msg.data);
        } else if (msg.type === 'flashcard') {
          renderFlashcardWidget(msg.content, msg.data, msg.category);
        } else if (msg.type === 'lesson') {
          renderLessonWidget(msg.content, msg.data, msg.category);
        }
      }

      // ——— Quiz ———
      function renderQuizWidget(intro, quiz) {
        addBotWidget(intro, (id, body) => {
          widgets.set(id, { quiz, answers: {}, questionIndex: 0, body, done: false });
          paintQuiz(id);
        });
      }

      function paintQuiz(id) {
        const w = widgets.get(id);
        if (!w || w.done) return;
        const qs = w.quiz.questions || [];
        const total = w.quiz.totalQuestions || qs.length;
        if (w.questionIndex >= qs.length) { submitQuiz(id); return; }
        const q = qs[w.questionIndex];
        const selected = w.answers[w.questionIndex];
        let html = '<div class="quiz-progress">Câu ' + (w.questionIndex + 1) + '/' + total + '</div>';
        html += '<div class="question-text">' + esc(q.question) + '</div><div class="options">';
        q.options.forEach((opt, idx) => {
          const letter = String.fromCharCode(65 + idx); // A, B, C, D
          let cls = 'option' + (selected === opt.id ? ' selected' : '');
          html += '<div class="' + cls + '" data-action="quiz-answer" data-wid="' + id + '" data-qidx="' + w.questionIndex + '" data-oid="' + esc(opt.id) + '">' +
            esc(letter + ') ' + opt.text) + '</div>';
        });
        html += '</div><div class="quiz-nav">';
        if (w.questionIndex > 0) html += '<button type="button" class="secondary" data-action="quiz-prev" data-wid="' + id + '">← Quay lại</button>';
        if (w.questionIndex < qs.length - 1) html += '<button type="button" data-action="quiz-next" data-wid="' + id + '">Tiếp →</button>';
        else html += '<button type="button" data-action="quiz-submit" data-wid="' + id + '">Nộp bài ✓</button>';
        html += '</div>';
        w.body.innerHTML = html;
        scrollLog();
      }

      async function submitQuiz(id) {
        const w = widgets.get(id);
        if (!w) return;
        const qs = w.quiz.questions || [];
        const answersArr = qs.map((q, i) => ({
          questionId: i + 1,
          selectedAnswer: w.answers[i] || '',
          correctAnswer: q.correctAnswer
        })).filter(a => a.selectedAnswer);
        if (!answersArr.length) {
          w.body.innerHTML = '<div class="error-inline">Bạn chưa trả lời câu nào!</div>';
          return;
        }
        w.body.innerHTML = '<div style="opacity:.7">Đang chấm...</div>';
        try {
          const res = await fetch(API_BASE + '/quiz/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answers: answersArr })
          });
          const result = await res.json();
          w.done = true;
          w.body.innerHTML = '<div class="quiz-result"><div>✅ Kết quả</div><div class="score-big">' + esc(String(result.score)) + '%</div><div>' +
            esc(String(result.correctAnswers)) + '/' + esc(String(result.totalQuestions)) + ' câu đúng</div></div>';
          scrollLog();
        } catch (e) {
          w.body.innerHTML = '<div class="error-inline">Lỗi: ' + esc(e.message) + '</div>';
        }
      }

      // ——— Flashcards ———
      function renderFlashcardWidget(intro, deck, category) {
        addBotWidget(intro, (id, body) => {
          const cards = (deck.cards || []).map(c => ({ ...c, flipped: false }));
          widgets.set(id, { deck: { ...deck, cards }, category: category || deck.type, index: 0, body });
          paintFlashcard(id);
        });
      }

      function paintFlashcard(id) {
        const w = widgets.get(id);
        if (!w) return;
        const cards = w.deck.cards || [];
        if (!cards.length) { w.body.innerHTML = '<div class="error-inline">Không có thẻ.</div>'; return; }
        const card = cards[w.index];
        const front = card.front || {};
        const back = card.back || {};
        const type = w.category || w.deck.type;
        const speechText = type === 'grammar' ? (front.grammar || front.title || '') : (front.word || front.hiragana || '');
        const forgotten = isForgotten(card, type);
        let frontHtml = '', backHtml = '';
        if (type === 'grammar') {
          frontHtml = '<div class="card-word">' + esc(front.grammar || front.title) + '</div><div class="card-romaji">' + esc(front.title) + '</div><div class="card-hint">👆 Bấm để lật</div>';
          backHtml = '<div class="card-meaning">' + esc(back.meaning) + '</div>';
          if (back.example && back.example.length) {
            back.example.forEach(ex => { backHtml += '<div class="item-example"><div>' + esc(ex.jp) + '</div><div>→ ' + esc(ex.vi) + '</div></div>'; });
          }
        } else {
          frontHtml = '<div class="card-word">' + esc(front.word) + '</div><div class="card-romaji">' + esc(front.hiragana) + '</div><div class="card-romaji">' + esc(front.romaji) + '</div><div class="card-hint">👆 Bấm để lật</div>';
          backHtml = '<div class="card-meaning">' + esc(back.meaning) + '</div>';
          if (back.example) backHtml += '<div class="item-example"><div>' + esc(back.example.furigana || back.example.jp) + '</div><div>→ ' + esc(back.example.vi) + '</div></div>';
        }
        let nav = '<div class="card-nav">';
        if (w.index > 0) nav += '<button type="button" class="secondary" data-action="card-prev" data-wid="' + id + '">← Trước</button>';
        if (w.index < cards.length - 1) nav += '<button type="button" data-action="card-next" data-wid="' + id + '">Sau →</button>';
        else nav += '<button type="button" class="secondary" data-action="card-reset" data-wid="' + id + '">🔄 Từ đầu</button>';
        nav += '</div>';
        w.body.innerHTML = '<div class="card-container"><div class="flashcard' + (card.flipped ? ' flipped' : '') + '" data-action="card-flip" data-wid="' + id + '">' +
          '<div class="card-front">' + frontHtml + '</div><div class="card-back">' + backHtml + '</div></div></div>' +
          '<div class="card-counter">Thẻ ' + (w.index + 1) + '/' + cards.length + (forgotten ? ' · Đang lưu: chưa nhớ' : '') + '</div>' +
          '<div class="study-actions"><button type="button" class="speak-button" data-action="speak" data-text="' + esc(speechText) + '">🔊 Nghe</button>' +
          '<button type="button" class="remembered-button" data-action="card-remembered" data-wid="' + id + '">✓ Đã nhớ</button>' +
          '<button type="button" class="forgotten-button" data-action="card-forgotten" data-wid="' + id + '">↻ Chưa nhớ</button></div>' +
          '<div class="pronunciation-actions"><button type="button" class="pronounce-button" data-action="pronounce" data-wid="' + id + '" data-text="' + esc(speechText) + '">🎙️ Luyện phát âm</button></div>' +
          '<div class="pronunciation-result" data-pronunciation-result style="display:none"></div>' + nav;
        scrollLog();
      }

      // ——— Lesson list ———
      function renderLessonWidget(intro, lessonData, category) {
        addBotWidget(intro, (id, body) => {
          const items = lessonData.items || [];
          if (!items.length) { body.innerHTML = '<div class="error-inline">Không có dữ liệu.</div>'; return; }
          let html = '<div class="items-grid">';
          items.forEach(item => {
            html += '<div class="item">';
            if (category === 'grammar') {
              html += '<div class="item-title">' + esc(item.grammar || item.title) + '</div><div>' + esc(item.meaning_vi) + '</div>';
              if (item.example && item.example.length) {
                item.example.slice(0, 2).forEach(ex => {
                  html += '<div class="item-example"><div>' + esc(ex.jp) + '</div><div>→ ' + esc(ex.vi) + '</div></div>';
                });
              }
            } else {
              html += '<div class="item-title">' + esc(item.word) + ' (' + esc(item.hiragana) + ')</div>';
              html += '<div>' + esc(item.meaning) + ' · ' + esc(item.romaji) + '</div>';
              if (item.example) html += '<div class="item-example"><div>' + esc(item.example.jp) + '</div><div>→ ' + esc(item.example.vi) + '</div></div>';
              html += '<div class="item-actions"><button type="button" class="speak-button" data-action="speak" data-text="' + esc(item.word || item.hiragana) + '">🔊 Nghe</button></div>';
            }
            html += '</div>';
          });
          html += '</div>';
          body.innerHTML = html;
          scrollLog();
        });
      }

      log.addEventListener('click', (e) => {
        const el = e.target.closest('[data-action]');
        if (!el) return;
        const action = el.dataset.action;
        if (action === 'speak') { speakJapanese(el.dataset.text); return; }
        if (action === 'forgotten-remove') {
          const items = loadForgottenItems().filter(item => item.itemId !== el.dataset.itemId);
          localStorage.setItem(FORGOTTEN_KEY, JSON.stringify(items));
          renderForgottenItems();
          el.closest('.msg')?.remove();
          return;
        }
        const id = parseInt(el.dataset.wid, 10);
        const w = widgets.get(id);
        if (!w) return;
        if (action === 'quiz-answer') { w.answers[parseInt(el.dataset.qidx, 10)] = el.dataset.oid; paintQuiz(id); }
        else if (action === 'quiz-prev') { w.questionIndex = Math.max(0, w.questionIndex - 1); paintQuiz(id); }
        else if (action === 'quiz-next') { w.questionIndex = Math.min((w.quiz.questions || []).length - 1, w.questionIndex + 1); paintQuiz(id); }
        else if (action === 'quiz-submit') submitQuiz(id);
        else if (action === 'card-flip') { w.deck.cards[w.index].flipped = !w.deck.cards[w.index].flipped; paintFlashcard(id); }
        else if (action === 'card-prev') { w.index = Math.max(0, w.index - 1); paintFlashcard(id); }
        else if (action === 'card-next') { w.index = Math.min(w.deck.cards.length - 1, w.index + 1); paintFlashcard(id); }
        else if (action === 'card-reset') { w.index = 0; w.deck.cards.forEach(c => { c.flipped = false; }); paintFlashcard(id); }
        else if (action === 'card-remembered') { markCard(w.deck.cards[w.index], w.category || w.deck.type, false); paintFlashcard(id); }
        else if (action === 'card-forgotten') { markCard(w.deck.cards[w.index], w.category || w.deck.type, true); paintFlashcard(id); }
        else if (action === 'pronounce') {
          const result = w.body.querySelector('[data-pronunciation-result]');
          result.style.display = 'block';
          startPronunciation(el.dataset.text, result);
        }
      });

      // ——— Conversations ———
      function formatDate(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        const now = new Date();
        if (d.toDateString() === now.toDateString()) {
          return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        }
        return d.toLocaleDateString('vi-VN', { day: 'numeric', month: 'short' });
      }

      async function loadSystemStatus() {
        const badge = document.getElementById('storage-badge');
        try {
          const res = await fetch(API_BASE + '/health', { cache: 'no-store' });
          const text = await res.text();
          let h;
          try { h = JSON.parse(text); } catch {
            badge.textContent = '⚠️ Mở http://localhost:5000 (không phải Live Preview)';
            return;
          }
          const parts = [];
          // parts.push(h.mongo ? 'MongoDB ✓' : 'Lưu file cục bộ');
          // parts.push(h.faiss ? 'FAISS ✓' : 'FAISS chưa build');
          if (h.conversations != null) parts.push(h.conversations + ' cuộc');
          badge.textContent = parts.join(' · ');
        } catch {
          badge.textContent = '⚠️ Server chưa chạy — npm start';
        }
      }

      async function loadConversationList() {
        try {
          const res = await fetch(API_BASE + '/conversations', { cache: 'no-store' });
          const raw = await res.text();
          if (!res.ok) throw new Error('HTTP ' + res.status);
          let list;
          try { list = JSON.parse(raw); } catch {
            throw new Error('Server trả HTML — hãy mở http://localhost:5000');
          }
          if (!Array.isArray(list)) list = [];
          if (!list.length) {
            convListEl.innerHTML = '<div class="conv-empty">Chưa có hội thoại.<br>Gửi tin nhắn hoặc bấm + mới.</div>';
            return list;
          }
          convListEl.innerHTML = '';
          list.forEach(c => {
            const row = document.createElement('div');
            row.className = 'conv-row' + (c.id === conversationId ? ' active' : '');
            
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'conv-item';
            btn.dataset.id = c.id;
            btn.innerHTML = '<div class="conv-title">' + esc(c.title) + '</div><div class="conv-meta">' + formatDate(c.updatedAt) + ' · ' + (c.messageCount || 0) + ' tin</div>';
            btn.addEventListener('click', () => {
              appEl.classList.remove('sidebar-open');
              openConversation(c.id);
            });
            
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'conv-del';
            del.title = 'Xóa cuộc trò chuyện';
            del.textContent = '×';
            del.addEventListener('click', (e) => {
              e.stopPropagation();
              deleteConversation(c.id, c.title);
            });
            
            row.appendChild(btn);
            row.appendChild(del);
            convListEl.appendChild(row);
          });
          updateDeleteButtonVisibility();
          return list;
        } catch (e) {
          convListEl.innerHTML = '<div class="conv-empty">Không tải được lịch sử.<br>' + esc(e.message) + '</div>';
          return [];
        }
      }

      function updateDeleteButtonVisibility() {
        const btn = document.getElementById('btn-del-chat');
        if (btn) btn.hidden = !conversationId;
      }

      async function deleteConversation(id, title) {
        const label = title ? '"' + title + '"' : 'cuộc này';
        if (!confirm('Xóa ' + label + '?\nKhông thể hoàn tác.')) return;
        try {
          const res = await fetch(API_BASE + '/conversations/' + id, { method: 'DELETE' });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          if (conversationId === id) {
            setConversationId(null);
            clearLog();
            chatTitleEl.textContent = 'Cuộc trò chuyện';
          }
          const list = await loadConversationList();
          await loadSystemStatus();
          if (conversationId === id || !conversationId) {
            if (list.length) await openConversation(list[0].id);
            else await startNewChat();
          }
        } catch (e) {
          alert('Không xóa được: ' + e.message);
        }
      }

      async function openConversation(id) {
        setConversationId(id);
        updateDeleteButtonVisibility();
        clearLog();
        chatTitleEl.textContent = 'Đang tải...';
        try {
          const res = await fetch(API_BASE + '/conversations/' + id);
          if (!res.ok) throw new Error('Not found');
          const conv = await res.json();
          chatTitleEl.textContent = conv.title || 'Cuộc trò chuyện';
          if (!conv.messages || !conv.messages.length) {
            showWelcome();
          } else {
            conv.messages.forEach(replayMessage);
          }
          await loadConversationList();
        } catch (e) {
          setConversationId(null);
          showWelcome();
          await loadConversationList();
        }
        input.focus();
      }

      function showWelcome() {
        clearLog();
        const div = document.createElement('div');
        div.className = 'welcome-dashboard';
        div.innerHTML = `
          <div class="welcome-hero">
            <span class="welcome-icon">🎌</span>
            <h2>Chào mừng bạn đến với N5 Chatbot!</h2>
            <p>Trợ lý ảo thông minh giúp bạn học tập, ôn luyện từ vựng và ngữ pháp tiếng Nhật N5 thông qua hội thoại tự nhiên.</p>
          </div>
          <div class="suggestions-grid">
            <div class="suggestion-card" onclick="sendSuggestion('ngữ pháp bài 15')">
              <span class="sugg-icon">📖</span>
              <div class="sugg-title">Học ngữ pháp</div>
              <div class="sugg-desc">"ngữ pháp bài 15"</div>
            </div>
            <div class="suggestion-card" onclick="sendSuggestion('từ vựng bài 5')">
              <span class="sugg-icon">✍️</span>
              <div class="sugg-title">Học từ vựng</div>
              <div class="sugg-desc">"từ vựng bài 5"</div>
            </div>
            <div class="suggestion-card" onclick="sendSuggestion('quiz bài 1')">
              <span class="sugg-icon">❓</span>
              <div class="sugg-title">Làm bài Quiz</div>
              <div class="sugg-desc">"quiz bài 1"</div>
            </div>
            <div class="suggestion-card" onclick="sendSuggestion('flashcard bài 10')">
              <span class="sugg-icon">🎴</span>
              <div class="sugg-title">Thẻ Flashcards</div>
              <div class="sugg-desc">"flashcard bài 10"</div>
            </div>
          </div>
        `;
        log.appendChild(div);
        scrollLog();
      }

      document.getElementById('btn-del-chat').addEventListener('click', () => {
        if (conversationId) deleteConversation(conversationId, chatTitleEl.textContent);
      });

      async function startNewChat() {
        try {
          const res = await fetch(API_BASE + '/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'Cuộc trò chuyện mới' })
          });
          const conv = await res.json();
          if (!res.ok) throw new Error(conv.error || 'Tạo cuộc trò chuyện thất bại');
          setConversationId(conv.id);
          updateDeleteButtonVisibility();
          clearLog();
          chatTitleEl.textContent = conv.title || 'Cuộc trò chuyện mới';
          showWelcome();
          await loadConversationList();
          await loadSystemStatus();
        } catch (e) {
          setConversationId(null);
          updateDeleteButtonVisibility();
          clearLog();
          chatTitleEl.textContent = 'Cuộc trò chuyện mới';
          showWelcome();
          addBotText('⚠️ Không tạo được cuộc mới: ' + e.message);
        }
        input.focus();
      }

      document.getElementById('btn-new-chat').addEventListener('click', () => startNewChat());

      function clearSelectedImage() {
        selectedImage = null;
        fileInput.value = '';
        attachmentPreview.classList.remove('visible');
        attachmentName.textContent = '';
      }

      function fileToBase64(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
          reader.onerror = () => reject(new Error('Không đọc được ảnh'));
          reader.readAsDataURL(file);
        });
      }

      attachBtn.addEventListener('click', () => fileInput.click());
      removeAttachmentBtn.addEventListener('click', clearSelectedImage);
      fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return clearSelectedImage();
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
          clearSelectedImage();
          addBotText('Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP.');
          return;
        }
        if (file.size > 5 * 1024 * 1024) {
          clearSelectedImage();
          addBotText('Ảnh phải nhỏ hơn hoặc bằng 5 MB.');
          return;
        }
        selectedImage = file;
        attachmentName.textContent = '📷 ' + file.name;
        attachmentPreview.classList.add('visible');
        input.placeholder = 'Hỏi về chữ hoặc nội dung trong ảnh…';
        input.focus();
      });

      // ——— Send ———
      async function send() {
        const message = input.value.trim();
        const imageFile = selectedImage;
        if (!message && !imageFile) return;
        
        // Remove welcome screen if it's currently showing
        const welcome = log.querySelector('.welcome-dashboard');
        if (welcome) {
          welcome.remove();
        }

        input.value = '';
        const visibleMessage = message || 'Hãy đọc và giải thích chữ tiếng Nhật trong ảnh này.';
        addUserMsg(imageFile ? `📷 ${imageFile.name}\n${visibleMessage}` : visibleMessage);
        if (!imageFile && isForgottenRequest(visibleMessage)) {
          renderForgottenItems();
          return;
        }
        sendBtn.disabled = true;
        input.disabled = true;
        attachBtn.disabled = true;
        try {
          let endpoint = API_BASE + '/chat';
          let payload = { message: visibleMessage, conversationId };
          if (imageFile) {
            endpoint = API_BASE + '/chat/image';
            payload = {
              message: visibleMessage,
              conversationId,
              image: {
                name: imageFile.name,
                mimeType: imageFile.type,
                data: await fileToBase64(imageFile)
              }
            };
          }
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.details ? data.error + '\n' + data.details : (data.error || 'Lỗi'));
          if (data.conversationId) {
            setConversationId(data.conversationId);
            updateDeleteButtonVisibility();
            if (chatTitleEl.textContent === 'Cuộc trò chuyện mới') {
              chatTitleEl.textContent = message.slice(0, 40) + (message.length > 40 ? '…' : '');
            }
          }
          handleResponse(data);
          if (imageFile) clearSelectedImage();
          await loadConversationList();
          await loadSystemStatus();
        } catch (e) {
          addBotText('Lỗi: ' + (e && e.message ? e.message : String(e)));
        } finally {
          sendBtn.disabled = false;
          input.disabled = false;
          attachBtn.disabled = false;
          if (!selectedImage) input.placeholder = 'VD: "ngữ pháp bài 15", "quiz bài 1"...';
          input.focus();
        }
      }

      sendBtn.addEventListener('click', send);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

      (async function init() {
        await loadSystemStatus();
        const list = await loadConversationList();
        if (conversationId && list.some(c => c.id === conversationId)) {
          await openConversation(conversationId);
        } else if (list.length > 0) {
          await openConversation(list[0].id);
        } else {
          await startNewChat();
        }
      })();

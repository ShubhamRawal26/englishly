/**
 * Englishly — Personal Grammar Coach
 * Pure Vanilla JavaScript Client Application
 */

(function () {
  'use strict';

  // --- DOM Elements ---
  const writingInput = document.getElementById('writing-input');
  const textCounter = document.getElementById('text-counter');
  const btnMic = document.getElementById('btn-mic');
  const btnClear = document.getElementById('btn-clear');
  const btnCheck = document.getElementById('btn-check');
  const btnCheckText = document.getElementById('btn-check-text');
  const speechIndicator = document.getElementById('speech-indicator');
  const alertBanner = document.getElementById('alert-banner');
  const resultsContainer = document.getElementById('results-container');
  const historyList = document.getElementById('history-list');
  const historyTotalBadge = document.getElementById('history-total-badge');
  const cloudStatus = document.getElementById('cloud-status');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');

  // Navigation
  const tabHome = document.getElementById('tab-home');
  const tabHistory = document.getElementById('tab-history');
  const viewHome = document.getElementById('view-home');
  const viewHistory = document.getElementById('view-history');
  const brandLink = document.getElementById('brand-link');

  // Modal
  const historyModal = document.getElementById('history-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const modalBody = document.getElementById('modal-body');

  // --- Application State ---
  let isChecking = false;
  let isRecording = false;
  let speechRecognition = null;
  let lastCheckedText = "";
  let currentUid = null;
  let localHistoryCache = [];
  let alertTimeout = null;

  // --- LanguageTool Endpoint ---
  const LANGUAGETOOL_API = "https://api.languagetool.org/v2/check";

  // =========================================================================
  // 1. Initialization
  // =========================================================================
  function init() {
    setupEventListeners();
    setupSpeechRecognition();
    setupTextCounter();
    
    // Initialize Firebase
    if (window.FirebaseService) {
      window.FirebaseService.init();
    }

    // Load initial local cache if any
    loadLocalFallbackHistory();
  }

  // =========================================================================
  // 2. Firebase Connectivity & Event Handlers
  // =========================================================================
  window.addEventListener('firebase-ready', (e) => {
    currentUid = e.detail.uid;
    updateSyncStatus(true, "Synced");
    listenToFirebaseHistory(currentUid);
  });

  window.addEventListener('firebase-error', () => {
    updateSyncStatus(false, "Local Mode");
    renderHistory(localHistoryCache);
  });

  function updateSyncStatus(online, label) {
    if (online) {
      statusDot.className = "status-dot";
      statusText.textContent = label;
      cloudStatus.title = "Connected securely to Firebase Realtime Database";
    } else {
      statusDot.className = "status-dot offline";
      statusText.textContent = label;
      cloudStatus.title = "Operating in offline local storage mode";
    }
  }

  // =========================================================================
  // 3. UI Events & Navigation
  // =========================================================================
  function setupEventListeners() {
    // Navigation Tabs
    tabHome.addEventListener('click', () => switchTab('home'));
    tabHistory.addEventListener('click', () => switchTab('history'));
    brandLink.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab('home');
    });

    // Editor Actions
    btnCheck.addEventListener('click', handleGrammarCheck);
    btnClear.addEventListener('click', handleClearEditor);
    btnMic.addEventListener('click', toggleSpeechRecognition);

    // API Key Settings
    const btnApiKey = document.getElementById('btn-api-key');
    if (btnApiKey) {
      btnApiKey.addEventListener('click', () => {
        const currentKey = getGroqApiKey();
        const masked = currentKey ? currentKey.substring(0, 7) + '...' + currentKey.substring(currentKey.length - 4) : 'Not configured';
        const newKey = prompt(`Groq AI Engine Key Settings\nCurrent key: ${masked}\n\nEnter your Groq API Key:`);
        if (newKey !== null && newKey.trim() !== '') {
          localStorage.setItem('englishly_groq_key', newKey.trim());
          showAlert("Groq API key saved.", "info");
        }
      });
    }

    // Modal Events
    btnCloseModal.addEventListener('click', closeModal);
    historyModal.addEventListener('click', (e) => {
      if (e.target === historyModal) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && historyModal.classList.contains('active')) {
        closeModal();
      }
    });
  }

  function switchTab(tabName) {
    if (tabName === 'home') {
      tabHome.classList.add('active');
      tabHistory.classList.remove('active');
      viewHome.classList.add('active');
      viewHistory.classList.remove('active');
    } else {
      tabHistory.classList.add('active');
      tabHome.classList.remove('active');
      viewHistory.classList.add('active');
      viewHome.classList.remove('active');
    }
  }

  function setupTextCounter() {
    writingInput.addEventListener('input', updateWordCounter);
    updateWordCounter();
  }

  function updateWordCounter() {
    const text = writingInput.value.trim();
    if (!text) {
      textCounter.textContent = "0 words";
      return;
    }
    const words = text.split(/\s+/).filter(Boolean);
    const count = words.length;
    textCounter.textContent = `${count} ${count === 1 ? 'word' : 'words'}`;
  }

  function handleClearEditor() {
    if (!writingInput.value.trim()) return;
    writingInput.value = "";
    updateWordCounter();
    resultsContainer.classList.remove('active');
    resultsContainer.innerHTML = "";
    hideAlert();
    writingInput.focus();
  }

  function showAlert(message, type = 'info') {
    if (alertTimeout) clearTimeout(alertTimeout);
    alertBanner.textContent = message;
    alertBanner.className = `alert-banner active ${type}`;
    alertTimeout = setTimeout(() => {
      hideAlert();
    }, 4000);
  }

  function hideAlert() {
    alertBanner.className = "alert-banner";
    alertBanner.textContent = "";
  }

  // =========================================================================
  // 4. Voice Input (Web Speech API)
  // =========================================================================
  function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      btnMic.title = "Voice recognition not supported in this browser";
      return;
    }

    speechRecognition = new SpeechRecognition();
    speechRecognition.continuous = true;
    speechRecognition.interimResults = false;
    speechRecognition.lang = 'en-US';

    speechRecognition.onstart = () => {
      isRecording = true;
      btnMic.classList.add('recording');
      speechIndicator.classList.add('active');
    };

    speechRecognition.onresult = (event) => {
      const results = event.results;
      let finalTranscript = '';

      for (let i = event.resultIndex; i < results.length; ++i) {
        if (results[i].isFinal) {
          finalTranscript += results[i][0].transcript;
        }
      }

      if (finalTranscript) {
        const currentText = writingInput.value;
        const separator = currentText.length > 0 && !currentText.endsWith(' ') ? ' ' : '';
        writingInput.value = currentText + separator + finalTranscript.trim();
        updateWordCounter();
      }
    };

    speechRecognition.onerror = (event) => {
      console.warn("Speech recognition error:", event.error);
      stopSpeechRecognition();
      if (event.error === 'not-allowed') {
        showAlert("Microphone permission denied.", "error");
      } else if (event.error === 'no-speech') {
        // Ignored, silence
      } else {
        showAlert("Microphone unavailable.", "error");
      }
    };

    speechRecognition.onend = () => {
      stopSpeechRecognition();
    };
  }

  function toggleSpeechRecognition() {
    if (!speechRecognition) {
      showAlert("Microphone unavailable.", "error");
      return;
    }

    if (isRecording) {
      speechRecognition.stop();
    } else {
      try {
        speechRecognition.start();
      } catch (err) {
        console.warn("Error starting speech recognition:", err);
      }
    }
  }

  function stopSpeechRecognition() {
    isRecording = false;
    btnMic.classList.remove('recording');
    speechIndicator.classList.remove('active');
  }

  // =========================================================================
  // 5. Deterministic Linguistic Rules (Augmenting LanguageTool)
  // =========================================================================
  const DETERMINISTIC_RULES = [
    // Direct address & salutations: "OK ma'am I" -> "OK, ma'am, I"
    {
      id: 'SALUTATION_DIRECT_ADDRESS',
      pattern: /\b(ok|okay|hello|hi|hey|dear)\s+(ma['’]am|sir|mr\b|mrs\b|ms\b|dr\b|boss|team)\s+([a-zA-Z])/gi,
      matchFn: (m, p1, p2, p3) => ({
        original: m[0],
        replacement: `${p1.toUpperCase()}, ${p2}, ${p3 === 'i' ? 'I' : p3}`,
        rule: "Set off direct address and salutations with commas (e.g., 'OK, ma'am, I').",
        category: "Punctuation"
      })
    },
    // Direct address without trailing comma: "ma'am I will" -> "ma'am, I will"
    {
      id: 'DIRECT_ADDRESS_TRAILING_COMMA',
      pattern: /\b(ma['’]am|sir)\s+([A-Z]|i\b)/gi,
      matchFn: (m, p1, p2) => ({
        original: m[0],
        replacement: `${p1}, ${p2 === 'i' ? 'I' : p2}`,
        rule: "Place a comma after a direct address before continuing a sentence.",
        category: "Punctuation"
      })
    },
    // Time expressions modifying nouns missing possessive: "in tomorrow meeting" -> "in tomorrow's meeting"
    {
      id: 'TEMPORAL_POSSESSIVE',
      pattern: /\b(in|during|for|at)\s+(tomorrow|yesterday|today|next\s+week)\s+(meeting|call|session|event|discussion|sync)\b/gi,
      matchFn: (m, p1, p2, p3) => ({
        original: m[0],
        replacement: `${p1} ${p2.toLowerCase()}'s ${p3}`,
        rule: "Use possessive 's with time expressions modifying nouns (e.g., 'tomorrow's meeting').",
        category: "Grammar"
      })
    },
    // "all things we/you" -> "all the things we/you"
    {
      id: 'ALL_THINGS_ARTICLE',
      pattern: /\ball\s+things\s+(we|you|they|I|he|she)\b/gi,
      matchFn: (m, p1) => ({
        original: m[0],
        replacement: `all the things ${p1}`,
        rule: "Use 'all the things' or 'everything' before a defining clause.",
        category: "Style"
      })
    },
    // "discuss parallel with" -> "discuss in parallel with"
    {
      id: 'PARALLEL_WITH_PREPOSITION',
      pattern: /\b(discuss|work|run|coordinate|execute|manage|proceed)\s+parallel\s+with\b/gi,
      matchFn: (m, p1) => ({
        original: m[0],
        replacement: `${p1} in parallel with`,
        rule: "Use the idiom 'in parallel with' when describing concurrent actions.",
        category: "Prepositions"
      })
    },
    // Plural possessive: "team members knowledge" -> "team members' knowledge"
    {
      id: 'PLURAL_POSSESSIVE',
      pattern: /\b(team\s+members|colleagues|workers|students|users|clients|parents)\s+(knowledge|ideas|feedback|skills|opinion|inputs|needs)\b/gi,
      matchFn: (m, p1, p2) => ({
        original: m[0],
        replacement: `${p1}' ${p2}`,
        rule: "Add an apostrophe to plural nouns ending in 's' to indicate possession (e.g., 'team members'').",
        category: "Punctuation"
      })
    },
    // Motion verbs missing preposition: "go market" -> "go to the market"
    {
      id: 'GO_TO_DESTINATION',
      pattern: /\b(go|going|went|gone)\s+(market|office|bank|hospital|airport|station)\b/gi,
      matchFn: (m, p1, p2) => ({
        original: m[0],
        replacement: `${p1} to the ${p2}`,
        rule: `Use 'to the ${p2}' after motion verbs.`,
        category: "Prepositions"
      })
    },
    // Redundant preposition: "discuss about" -> "discuss"
    {
      id: 'DISCUSS_ABOUT',
      pattern: /\b(discuss|discussed|discussing)\s+about\b/gi,
      matchFn: (m, p1) => ({
        original: m[0],
        replacement: p1,
        rule: "The verb 'discuss' is transitive; do not use 'about' after it.",
        category: "Redundancy"
      })
    },
    // Redundant: "revert back" -> "revert" / "reply"
    {
      id: 'REVERT_BACK',
      pattern: /\b(revert|reverting|reverted)\s+back\b/gi,
      matchFn: (m, p1) => ({
        original: m[0],
        replacement: p1,
        rule: "The word 'back' is redundant with 'revert'. Use 'revert' alone or 'reply'.",
        category: "Redundancy"
      })
    },
    // Lowercase "i"
    {
      id: 'LOWERCASE_I',
      pattern: /(^|\s)i(\s|[.,!?;:]|$)/g,
      matchFn: (m, p1, p2) => ({
        original: m[0],
        replacement: `${p1}I${p2}`,
        rule: "The pronoun 'I' must always be capitalized.",
        category: "Capitalization"
      })
    },
    // Common contractions without apostrophe
    {
      id: 'COMMON_CONTRACTIONS',
      pattern: /\b(dont|cant|wont|didnt|doesnt|isnt|arent|wasnt|werent|couldnt|shouldnt|wouldnt|youre|theyre|weve|youve|theyve)\b/gi,
      matchFn: (m, p1) => {
        const map = {
          dont: "don't", cant: "can't", wont: "won't", didnt: "didn't",
          doesnt: "doesn't", isnt: "isn't", arent: "aren't", wasnt: "wasn't",
          werent: "weren't", couldnt: "couldn't", shouldnt: "shouldn't",
          wouldnt: "wouldn't", youre: "you're", theyre: "they're",
          weve: "we've", youve: "you've", theyve: "they've"
        };
        const lower = p1.toLowerCase();
        const replacement = map[lower] || p1;
        return {
          original: m[0],
          replacement: p1[0] === p1[0].toUpperCase() ? replacement[0].toUpperCase() + replacement.slice(1) : replacement,
          rule: `Add an apostrophe in the contraction '${replacement}'.`,
          category: "Punctuation"
        };
      }
    }
  ];

  function checkDeterministicRules(rawText) {
    const issues = [];
    for (const r of DETERMINISTIC_RULES) {
      r.pattern.lastIndex = 0;
      let match;
      while ((match = r.pattern.exec(rawText)) !== null) {
        const res = r.matchFn(match, match[1], match[2], match[3]);
        issues.push({
          offset: match.index,
          length: match[0].length,
          original: res.original,
          replacement: res.replacement,
          rule: res.rule,
          category: res.category,
          source: 'rule_engine'
        });
      }
    }
    return issues;
  }

  function mergeGrammarIssues(rawText, ltMatches, customIssues) {
    const ltIssues = ltMatches.map(m => ({
      offset: m.offset,
      length: m.length,
      original: rawText.substring(m.offset, m.offset + m.length),
      replacement: (m.replacements && m.replacements.length > 0) ? m.replacements[0].value : "",
      rule: (m.rule && m.rule.description) ? m.rule.description : (m.message || "Grammar suggestion"),
      category: (m.rule && m.rule.category && m.rule.category.name) ? m.rule.category.name : "Grammar",
      source: 'languagetool'
    }));

    const all = [...customIssues, ...ltIssues];
    all.sort((a, b) => a.offset - b.offset);

    const nonOverlapping = [];
    for (const issue of all) {
      const end = issue.offset + issue.length;
      const overlap = nonOverlapping.find(existing => {
        const existingEnd = existing.offset + existing.length;
        return !(end <= existing.offset || issue.offset >= existingEnd);
      });

      if (!overlap) {
        nonOverlapping.push(issue);
      } else if (issue.source === 'rule_engine' && overlap.source === 'languagetool') {
        const idx = nonOverlapping.indexOf(overlap);
        nonOverlapping[idx] = issue;
      }
    }

    return nonOverlapping;
  }

  // =========================================================================
  // 6. Groq AI High-Precision Grammar Engine
  // =========================================================================
  const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
  function getGroqApiKey() {
    return (window.APP_CONFIG && window.APP_CONFIG.GROQ_API_KEY) ||
           (typeof localStorage !== 'undefined' && localStorage.getItem('englishly_groq_key')) ||
           "";
  }
  const GROQ_MODEL = "qwen/qwen3.8-27b";

  async function checkWithGroq(text) {
    const apiKey = getGroqApiKey();
    if (!apiKey) {
      throw new Error("No Groq API key available");
    }

    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: "system",
            content: 'You are an expert English grammar coach. Analyze the user text for grammar, word order, spelling, punctuation, prepositions, tense, and phrasing errors. Return ONLY a valid JSON object in this exact schema:\n{\n  "correctedText": "complete corrected sentence",\n  "mistakes": [\n    {\n      "original": "incorrect word or phrase",\n      "replacement": "corrected word or phrase",\n      "rule": "concise, easy-to-understand explanation of the grammar rule",\n      "category": "Grammar | Word Order | Punctuation | Spelling | Prepositions | Style"\n    }\n  ]\n}\nIf there are NO mistakes, "mistakes" must be an empty array [] and "correctedText" should match the user text.'
          },
          {
            role: "user",
            content: `Analyze this English text and return JSON:\n"${text}"`
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1
      })
    });

    if (!response.ok) {
      throw new Error(`Groq API returned ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    return JSON.parse(content);
  }

  // =========================================================================
  // 7. Grammar Checking Controller
  // =========================================================================
  async function handleGrammarCheck() {
    const text = writingInput.value.trim();

    if (!text) {
      showAlert("Nothing to check.", "info");
      writingInput.focus();
      return;
    }

    if (isChecking) return;

    if (isRecording && speechRecognition) {
      speechRecognition.stop();
    }

    setCheckingState(true);
    hideAlert();

    try {
      // 1. Primary: Try Groq AI for deep grammatical structure & conversational accuracy
      try {
        const groqResult = await checkWithGroq(text);
        if (groqResult && typeof groqResult.correctedText === 'string') {
          const mistakes = Array.isArray(groqResult.mistakes) ? groqResult.mistakes : [];
          lastCheckedText = text;
          renderGrammarResults(text, groqResult.correctedText, mistakes, mistakes.length);
          saveCheckRecord({
            originalText: text,
            correctedText: groqResult.correctedText,
            mistakes: mistakes,
            mistakeCount: mistakes.length,
            createdAt: Date.now()
          });
          return;
        }
      } catch (groqErr) {
        console.warn("Groq AI check notice, falling back to rule engine:", groqErr.message);
      }

      // 2. Fallback: LanguageTool + Deterministic linguistic rules
      const textHasPunctuation = /[.!?]$/.test(text);
      const textForApi = textHasPunctuation ? text : text + '.';

      const formData = new URLSearchParams();
      formData.append('text', textForApi);
      formData.append('language', 'en-US');
      formData.append('level', 'picky');
      formData.append('enabledCategories', 'PUNCTUATION,TYPOGRAPHY,CASING,COLLOCATIONS,CONFUSED_WORDS,MISC,STYLE,REDUNDANCY,GRAMMAR,SEMANTICS');

      let ltMatches = [];
      try {
        const response = await fetch(LANGUAGETOOL_API, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
          },
          body: formData.toString()
        });

        if (response.ok) {
          const data = await response.json();
          ltMatches = (data.matches || []).filter(m => m.offset < text.length);
        }
      } catch (apiErr) {
        console.warn("LanguageTool API notice:", apiErr);
      }

      const customIssues = checkDeterministicRules(text);
      const mergedMistakes = mergeGrammarIssues(text, ltMatches, customIssues);

      lastCheckedText = text;
      processCheckResults(text, mergedMistakes);

    } catch (err) {
      console.warn("Grammar check error:", err);
      showAlert("Couldn't check right now.", "error");
    } finally {
      setCheckingState(false);
    }
  }

  function setCheckingState(checking) {
    isChecking = checking;
    btnCheck.disabled = checking;
    btnCheckText.textContent = checking ? "Checking..." : "Check";
  }

  function processCheckResults(originalText, mistakes) {
    // 1. Build corrected text by replacing from highest offset to lowest
    const sortedDescending = [...mistakes].sort((a, b) => b.offset - a.offset);
    let correctedText = originalText;

    sortedDescending.forEach((m) => {
      if (m.replacement && m.replacement !== "—") {
        correctedText = correctedText.substring(0, m.offset) + m.replacement + correctedText.substring(m.offset + m.length);
      }
    });

    // Add trailing period if sentence is multiple words and has no ending punctuation
    if (!/[.!?]$/.test(correctedText.trim()) && correctedText.trim().split(/\s+/).length > 2) {
      correctedText = correctedText.trim() + '.';
    }

    // Capitalize first character if needed
    if (correctedText.length > 0) {
      correctedText = correctedText.charAt(0).toUpperCase() + correctedText.slice(1);
    }

    const mistakeCount = mistakes.length;

    // 2. Render results in UI
    renderGrammarResults(originalText, correctedText, mistakes, mistakeCount);

    // 3. Save to Firebase Realtime Database
    saveCheckRecord({
      originalText,
      correctedText,
      mistakes,
      mistakeCount,
      createdAt: Date.now()
    });
  }

  function renderGrammarResults(originalText, correctedText, mistakes, count) {
    resultsContainer.innerHTML = "";
    resultsContainer.classList.add('active');

    // Header with mistake count
    const headerEl = document.createElement('div');
    headerEl.className = "results-header";
    headerEl.innerHTML = `
      <div class="results-title-group">
        <h3 class="results-title">Result</h3>
        <span class="badge ${count === 0 ? 'badge-clean' : 'badge-mistake'}">
          ${count === 0 ? '0 mistakes' : `${count} ${count === 1 ? 'mistake' : 'mistakes'}`}
        </span>
      </div>
    `;
    resultsContainer.appendChild(headerEl);

    // Clean state: 0 mistakes
    if (count === 0) {
      const cleanCard = document.createElement('div');
      cleanCard.className = "clean-state-card";
      cleanCard.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <div class="clean-state-text">
          <h4>No mistakes found.</h4>
          <p>Your English is clear, natural, and well-structured.</p>
        </div>
      `;
      resultsContainer.appendChild(cleanCard);
      return;
    }

    // Corrected version preview box
    const previewCard = document.createElement('div');
    previewCard.className = "corrected-preview-card";
    previewCard.innerHTML = `
      <div class="corrected-preview-header">
        <span class="corrected-preview-label">Corrected Version</span>
        <div style="display: flex; gap: 8px;">
          <button type="button" class="btn-text-action" id="btn-apply-correction" title="Replace editor text with this corrected version">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            Apply
          </button>
          <button type="button" class="btn-text-action" id="btn-copy-correction" title="Copy corrected text">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Copy
          </button>
        </div>
      </div>
      <p class="corrected-preview-text">${escapeHtml(correctedText)}</p>
    `;
    resultsContainer.appendChild(previewCard);

    // Hook copy and apply actions
    const btnApply = previewCard.querySelector('#btn-apply-correction');
    const btnCopy = previewCard.querySelector('#btn-copy-correction');

    btnApply.addEventListener('click', () => {
      writingInput.value = correctedText;
      updateWordCounter();
      showAlert("Applied correction to editor.", "info");
      writingInput.focus();
    });

    btnCopy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(correctedText);
        showAlert("Copied to clipboard.", "info");
      } catch (err) {
        console.warn("Clipboard copy failed:", err);
      }
    });

    // List of individual mistake cards
    const mistakesList = document.createElement('div');
    mistakesList.className = "mistakes-list";

    mistakes.forEach((mistake) => {
      const card = document.createElement('article');
      card.className = "mistake-card";
      card.innerHTML = `
        <div class="mistake-comparison">
          <span class="mistake-original">${escapeHtml(mistake.original)}</span>
          <span class="mistake-arrow">→</span>
          <span class="mistake-suggested">${escapeHtml(mistake.replacement)}</span>
        </div>
        <p class="mistake-rule">${escapeHtml(mistake.rule)}</p>
        <span class="mistake-category">${escapeHtml(mistake.category)}</span>
      `;
      mistakesList.appendChild(card);
    });

    resultsContainer.appendChild(mistakesList);
  }

  // =========================================================================
  // 6. Firebase Realtime Database & Persistence
  // =========================================================================
  function saveCheckRecord(record) {
    // If Firebase is available and user is authenticated
    const db = window.FirebaseService && window.FirebaseService.getDb ? window.FirebaseService.getDb() : null;
    const uid = window.FirebaseService && window.FirebaseService.getUid ? window.FirebaseService.getUid() : null;

    if (db && uid) {
      try {
        const historyRef = db.ref(`users/${uid}/history`);
        const newEntryRef = historyRef.push();
        newEntryRef.set(record).catch((err) => {
          console.warn("Failed to persist to Firebase, using local cache:", err.message);
          saveToLocalCache(record);
        });
      } catch (err) {
        console.warn("Database error:", err.message);
        saveToLocalCache(record);
      }
    } else {
      saveToLocalCache(record);
    }
  }

  function saveToLocalCache(record) {
    record.id = "local_" + Date.now();
    localHistoryCache.unshift(record);
    try {
      localStorage.setItem('englishly_history', JSON.stringify(localHistoryCache.slice(0, 50)));
    } catch (e) {
      // Quota exceeded or private browsing
    }
    renderHistory(localHistoryCache);
  }

  function loadLocalFallbackHistory() {
    try {
      const raw = localStorage.getItem('englishly_history');
      if (raw) {
        localHistoryCache = JSON.parse(raw);
        renderHistory(localHistoryCache);
      }
    } catch (e) {
      localHistoryCache = [];
    }
  }

  function listenToFirebaseHistory(uid) {
    const db = window.FirebaseService.getDb();
    if (!db) return;

    try {
      const historyRef = db.ref(`users/${uid}/history`).orderByChild('createdAt');
      historyRef.on('value', (snapshot) => {
        const items = [];
        snapshot.forEach((child) => {
          items.push({
            id: child.key,
            ...child.val()
          });
        });
        // Sort newest first
        items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        localHistoryCache = items;
        renderHistory(items);
      }, (error) => {
        console.warn("Realtime history subscription error:", error.message);
        showAlert("History couldn't be loaded.", "error");
        renderHistory(localHistoryCache);
      });
    } catch (err) {
      console.warn("Firebase listener failure:", err);
    }
  }

  function deleteHistoryItem(id, event) {
    event.stopPropagation();

    const db = window.FirebaseService && window.FirebaseService.getDb ? window.FirebaseService.getDb() : null;
    const uid = window.FirebaseService && window.FirebaseService.getUid ? window.FirebaseService.getUid() : null;

    if (db && uid && !id.startsWith('local_')) {
      db.ref(`users/${uid}/history/${id}`).remove().catch((err) => {
        console.warn("Failed to delete history item from Firebase:", err.message);
      });
    }

    // Also remove from local cache
    localHistoryCache = localHistoryCache.filter(item => item.id !== id);
    try {
      localStorage.setItem('englishly_history', JSON.stringify(localHistoryCache));
    } catch (e) {}
    renderHistory(localHistoryCache);
  }

  // =========================================================================
  // 7. Render History View (Categorized by Today / Older)
  // =========================================================================
  function renderHistory(items) {
    historyTotalBadge.textContent = `${items.length} saved`;
    historyList.innerHTML = "";

    if (!items || items.length === 0) {
      historyList.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <p>No history yet.<br>Start writing to see your corrections here.</p>
        </div>
      `;
      return;
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayItems = [];
    const olderItems = [];

    items.forEach((item) => {
      const itemDate = new Date(item.createdAt || Date.now());
      if (itemDate >= todayStart) {
        todayItems.push(item);
      } else {
        olderItems.push(item);
      }
    });

    if (todayItems.length > 0) {
      appendHistoryGroup("Today", todayItems);
    }
    if (olderItems.length > 0) {
      appendHistoryGroup("Older", olderItems);
    }
  }

  function appendHistoryGroup(title, items) {
    const groupEl = document.createElement('div');
    groupEl.innerHTML = `<div class="history-group-label">${title}</div>`;

    const listEl = document.createElement('div');
    listEl.className = "history-items-list";

    items.forEach((item) => {
      const card = document.createElement('div');
      card.className = "history-item-card";
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');

      const timeStr = formatTime(item.createdAt);
      const count = item.mistakeCount || 0;
      const countBadge = count === 0
        ? `<span class="badge badge-clean">0 mistakes</span>`
        : `<span class="badge badge-mistake">${count} ${count === 1 ? 'mistake' : 'mistakes'}</span>`;

      card.innerHTML = `
        <div class="history-item-content">
          <div class="history-item-snippet">${escapeHtml(item.originalText || '')}</div>
          <div class="history-item-sub">
            ${countBadge}
            <span>${timeStr}</span>
          </div>
        </div>
        <button type="button" class="btn-history-delete" title="Delete this check" aria-label="Delete check">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18"/>
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
          </svg>
        </button>
      `;

      // Click card to inspect
      card.addEventListener('click', () => openHistoryDetailModal(item));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          openHistoryDetailModal(item);
        }
      });

      // Delete button
      const btnDelete = card.querySelector('.btn-history-delete');
      btnDelete.addEventListener('click', (e) => deleteHistoryItem(item.id, e));

      listEl.appendChild(card);
    });

    groupEl.appendChild(listEl);
    historyList.appendChild(groupEl);
  }

  // =========================================================================
  // 8. History Item Inspection Modal
  // =========================================================================
  function openHistoryDetailModal(item) {
    modalBody.innerHTML = `
      <div>
        <div class="modal-section-title">Original Text</div>
        <div class="modal-text-box">${escapeHtml(item.originalText || '')}</div>
      </div>

      <div>
        <div class="modal-section-title">Corrected Version</div>
        <div class="modal-text-box corrected">${escapeHtml(item.correctedText || '')}</div>
      </div>

      <div>
        <div class="modal-section-title">Mistakes & Rules (${item.mistakeCount || 0})</div>
        <div class="mistakes-list" style="margin-top: 8px;">
          ${(item.mistakes && item.mistakes.length > 0)
            ? item.mistakes.map(m => `
                <div class="mistake-card">
                  <div class="mistake-comparison">
                    <span class="mistake-original">${escapeHtml(m.original)}</span>
                    <span class="mistake-arrow">→</span>
                    <span class="mistake-suggested">${escapeHtml(m.replacement)}</span>
                  </div>
                  <p class="mistake-rule">${escapeHtml(m.rule)}</p>
                </div>
              `).join('')
            : '<div style="font-size: 0.88rem; color: var(--brand-green);">No mistakes were detected in this check.</div>'
          }
        </div>
      </div>

      <div style="display: flex; gap: 8px; margin-top: 8px;">
        <button type="button" class="btn-primary" style="flex: 1; max-width: none;" id="btn-load-into-editor">
          Load into Editor
        </button>
      </div>
    `;

    // Hook load into editor
    const btnLoad = modalBody.querySelector('#btn-load-into-editor');
    btnLoad.addEventListener('click', () => {
      writingInput.value = item.originalText || '';
      updateWordCounter();
      closeModal();
      switchTab('home');
      renderGrammarResults(
        item.originalText,
        item.correctedText,
        item.mistakes || [],
        item.mistakeCount || 0
      );
    });

    historyModal.classList.add('active');
  }

  function closeModal() {
    historyModal.classList.remove('active');
  }

  // =========================================================================
  // 9. Utility Functions
  // =========================================================================
  function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

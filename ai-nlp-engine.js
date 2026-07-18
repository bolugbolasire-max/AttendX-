// ai-nlp-engine.js
//
// Shared, dependency-free NLP toolkit for AttendX AI.
// Plain script (no ES module syntax) so it can be loaded with a normal
// <script> tag on every page and used by both:
//   - ai-chat-widget.js (also a plain script)
//   - ai-*-handlers.js  (type="module" scripts — they read window.AttendXNLP)
//
// Everything here is self-contained: no network calls, no external
// libraries, no API keys. Pure JavaScript running in the browser.
//
// WHAT THIS FILE ADDS (over the old plain .includes() matching):
//   1. normalize()        — consistent lowercasing/punctuation stripping
//   2. STOPWORDS / SYNONYMS — a small built-in thesaurus so "photo id",
//      "camera scan" etc. still resolve to "face verification"
//   3. levenshtein() / isFuzzyMatch() — typo tolerance ("attendence",
//      "faciel recognition", "qr cod" still match)
//   4. tokenize()          — splits + expands synonyms + drops stopwords
//   5. scoreTextAgainstQuery() — TF-IDF-ish overlap score between a query
//      and a piece of text, used to RANK candidates instead of just
//      taking the first keyword hit
//   6. ConversationContext — tiny in-memory class that remembers the last
//      topic/entities so follow-up questions like "what about GPS?" or
//      "and for lecturers?" resolve correctly
//
// Include this file FIRST, before ai-chat-widget.js and any handler file:
//   <script src="ai-nlp-engine.js"></script>
//   <script src="ai-chat-widget.js" defer></script>
//   <script type="module" src="ai-student-handlers.js"></script>

(function (global) {
  "use strict";

  // ==========================================================
  // 1. NORMALIZATION
  // ==========================================================
  function normalize(text) {
    if (!text) return "";
    return text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "") // strip accents
      .replace(/[^\w\s]/g, " ")        // punctuation -> space
      .replace(/\s+/g, " ")
      .trim();
  }

  // ==========================================================
  // 2. STOPWORDS + SYNONYMS
  // Small, hand-picked for AttendX's domain — not a generic NLP library.
  // Keeping this data-driven means non-developers can extend the bot's
  // vocabulary later just by editing this object, no logic changes needed.
  // ==========================================================
  const STOPWORDS = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "am",
    "do", "does", "did", "i", "you", "he", "she", "it", "we", "they",
    "my", "your", "his", "her", "its", "our", "their", "me", "him",
    "us", "them", "to", "of", "in", "on", "at", "for", "with", "about",
    "as", "by", "and", "or", "but", "if", "so", "this", "that", "these",
    "those", "there", "here", "can", "could", "will", "would", "should",
    "please", "just", "really", "very", "up", "out", "how", "what",
    "when", "does", "did", "have", "has", "had",
    // Generic filler words that show up across many different topics
    // (e.g. "check" appears in both "GPS check" and "face check") — if
    // these carry full scoring weight they cause ties/false positives
    // between unrelated knowledge base entries. Kept OUT of the
    // SYNONYMS map (so "check in" -> "checkin" as a phrase still works)
    // but stripped as standalone tokens before scoring.
    "check", "verify", "verification", "confirm"
  ]);

  // Map alternate phrasing -> canonical term(s). Every key and every
  // value is matched as a whole word/phrase after normalization.
  // This is what lets "camera scan", "photo verification", "selfie check"
  // all land on the "face" concept without listing every keyword by hand
  // in the knowledge base itself.
  const SYNONYMS = {
    "attendence": "attendance",
    "atendance": "attendance",
    "attandance": "attendance",
    "presence": "attendance",
    "signin": "attendance",
    "sign in": "attendance",
    "check in": "checkin",
    "checked in": "checkin",
    "checking in": "checkin",
    "camera": "face",
    "selfie": "face",
    "photo verification": "face",
    "facial": "face",
    "faciel": "face",
    "impersonation": "face",
    "buddy punching": "face",
    "cheating": "face",
    "fake attendance": "face",
    "location": "gps",
    "geolocation": "gps",
    "geo location": "gps",
    "off campus": "gps outside",
    "outside campus": "gps outside",
    "far away": "gps outside",
    "scan code": "qr",
    "barcode": "qr",
    "quick response": "qr",
    "qr cod": "qr",
    "download": "export",
    "spreadsheet": "export report",
    "excel": "export report",
    "sign up": "register",
    "signup": "register",
    "registration": "register",
    "create account": "register",
    "join": "register",
    "log in": "login",
    "signin issue": "login",
    "cant login": "login forgot password",
    "locked out": "login forgot password",
    "reset": "forgot password",
    "phone": "mobile",
    "app": "mobile",
    "cell": "mobile",
    "device": "mobile",
    "cost": "pricing",
    "price": "pricing",
    "fee": "pricing",
    "free": "pricing",
    "how much": "pricing",
    "safe": "security",
    "privacy": "security",
    "data protection": "security",
    "hi": "hello",
    "hey": "hello",
    "yo": "hello",
    "good morning": "hello",
    "good afternoon": "hello",
    "good evening": "hello",
    "thx": "thanks",
    "thank you": "thanks",
    "appreciate it": "thanks",
    "lecturer": "lecturer",
    "teacher": "lecturer",
    "professor": "lecturer",
    "instructor": "lecturer",
    "admin": "administrator",
    "school admin": "school administrator",
    "superadmin": "super administrator",
    "super admin": "super administrator",
    "student": "student",
    "learner": "student",
    "pupil": "student",
    "class": "session",
    "lecture": "session",
    "how many": "count",
    "number of": "count",
    "total": "count",
    "latest": "recent",
    "last": "recent",
    "current": "recent",
    "most recent": "recent",
    "active": "ongoing",
    "live": "ongoing",
    "pending": "awaiting",
    "waiting": "awaiting"
  };

  // Sort synonym keys longest-first so multi-word phrases are replaced
  // before their shorter substrings (e.g. "check in" before "in").
  const SYNONYM_KEYS = Object.keys(SYNONYMS).sort((a, b) => b.length - a.length);

  function applySynonyms(normalizedText) {
    let text = ` ${normalizedText} `;
    SYNONYM_KEYS.forEach((key) => {
      const pattern = new RegExp(`\\b${key.replace(/\s+/g, "\\s+")}\\b`, "g");
      text = text.replace(pattern, ` ${SYNONYMS[key]} `);
    });
    return text.replace(/\s+/g, " ").trim();
  }

  // ==========================================================
  // 3. TYPO TOLERANCE — Levenshtein edit distance
  // ==========================================================
  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    let prevRow = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prevRow[j] = j;

    for (let i = 1; i <= a.length; i++) {
      const currRow = [i];
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        currRow[j] = Math.min(
          prevRow[j] + 1,      // deletion
          currRow[j - 1] + 1,  // insertion
          prevRow[j - 1] + cost // substitution
        );
      }
      prevRow = currRow;
    }
    return prevRow[b.length];
  }

  // Allowed typo "budget" scales with word length so short words
  // ("qr", "gps") aren't fuzzily matched into nonsense, but longer words
  // ("attendance", "verification") tolerate a couple of typos.
  function maxEditsFor(wordLength) {
    if (wordLength <= 3) return 0;
    if (wordLength <= 6) return 1;
    return 2;
  }

  function isFuzzyMatch(wordA, wordB) {
    if (wordA === wordB) return true;
    const maxLen = Math.max(wordA.length, wordB.length);
    const minLen = Math.min(wordA.length, wordB.length);
    if (maxLen - minLen > 2) return false; // too different in length, skip distance calc
    const allowed = maxEditsFor(minLen);
    if (allowed === 0) return false;
    return levenshtein(wordA, wordB) <= allowed;
  }

  // ==========================================================
  // 4. TOKENIZATION
  // ==========================================================
  function tokenize(rawText) {
    const normalized = normalize(rawText);
    const withSynonyms = applySynonyms(normalized);
    return withSynonyms
      .split(" ")
      .filter((tok) => tok && !STOPWORDS.has(tok));
  }

  // ==========================================================
  // 5. RELEVANCE SCORING
  // Scores how well a query matches a target string/keyword list.
  // Combines: exact substring bonus, token overlap, and fuzzy token
  // matches for typo tolerance. Returns a numeric score (0 = no match).
  // This replaces "first keyword that .includes() matches wins" with
  // "score every candidate, return the best one".
  // ==========================================================
  function scoreQueryAgainstKeywords(queryTokens, keywordText) {
    const keywordTokens = tokenize(keywordText);
    if (!keywordTokens.length) return 0;

    let score = 0;
    let matchedCount = 0;

    keywordTokens.forEach((kwTok) => {
      let bestTokenScore = 0;
      queryTokens.forEach((qTok) => {
        if (qTok === kwTok) {
          bestTokenScore = Math.max(bestTokenScore, 3); // exact token match
        } else if (isFuzzyMatch(qTok, kwTok)) {
          bestTokenScore = Math.max(bestTokenScore, 1.5); // typo-tolerant match
        }
      });
      if (bestTokenScore > 0) {
        matchedCount++;
        score += bestTokenScore;
      }
    });

    // Reward matching a larger fraction of the keyword phrase's tokens —
    // this is what lets multi-word phrases outrank a single stray word
    // hit, without needing exact substring matching.
    const coverage = matchedCount / keywordTokens.length;
    if (coverage < 0.5) return 0; // require at least half the phrase to match

    return score * coverage;
  }

  // Finds the best-scoring entry from a list of { keywords: [...], ...}
  // candidates. Used for FAQ matching in the widget.
  function findBestKnowledgeMatch(userText, knowledgeBase, options) {
    const opts = options || {};
    const minScore = opts.minScore != null ? opts.minScore : 1.2;
    const queryTokens = tokenize(userText);
    if (!queryTokens.length) return null;

    let best = null;
    let bestScore = 0;

    knowledgeBase.forEach((entry) => {
      let entryBest = 0;
      entry.keywords.forEach((kw) => {
        const s = scoreQueryAgainstKeywords(queryTokens, kw);
        if (s > entryBest) entryBest = s;
      });
      if (entryBest > bestScore) {
        bestScore = entryBest;
        best = entry;
      }
    });

    if (bestScore < minScore) return null;
    return { entry: best, score: bestScore };
  }

  // Generic ranked search over ANY array of objects with a text field —
  // used by the Firestore handlers to rank documents (e.g. sessions by
  // course name relevance) instead of just taking the newest/first one.
  function rankByRelevance(userText, items, getTextFn) {
    const queryTokens = tokenize(userText);
    if (!queryTokens.length) return items.map((item) => ({ item, score: 0 }));

    return items
      .map((item) => {
        const text = getTextFn(item) || "";
        const score = scoreQueryAgainstKeywords(queryTokens, text);
        return { item, score };
      })
      .sort((a, b) => b.score - a.score);
  }

  // ==========================================================
  // 6. INTENT / SLOT DETECTION
  // Small helper so handler files don't each re-invent their own regex
  // soup. Detects common question "shapes" AttendX cares about.
  // ==========================================================
  function detectIntent(rawText) {
    const tokens = tokenize(rawText); // already synonym-expanded
    const joined = ` ${tokens.join(" ")} `;

    // Tokens aren't stemmed (no "lecturers" -> "lecturer"), so every
    // flag below tolerates an optional trailing "s"/"es" rather than
    // requiring the exact singular form.
    return {
      tokens,
      wantsCount: /\bcounts?\b/.test(joined),
      wantsRecent: /\brecents?\b/.test(joined),
      wantsOngoing: /\bongoings?\b/.test(joined),
      wantsAwaiting: /\bawaitings?\b/.test(joined),
      mentionsSession: /\bsessions?\b/.test(joined),
      mentionsAttendance: /\battendances?\b|\bcheckins?\b/.test(joined),
      mentionsLecturer: /\blecturers?\b/.test(joined),
      mentionsCourse: /\bcourses?\b/.test(joined),
      mentionsSchool: /\bschools?\b/.test(joined),
      mentionsAdministrator: /\badministrators?\b/.test(joined),
      mentionsExport: /\bexports?\b|\breports?\b/.test(joined),
      mentionsToday: /\btoday\b/.test(joined),
      isGreeting: /\bhellos?\b/.test(joined),
      isThanks: /\bthanks?\b/.test(joined)
    };
  }

  // ==========================================================
  // 7. CONVERSATION CONTEXT
  // Tiny in-memory (per-session, resets on reload — matches existing
  // behavior) tracker so follow-up questions resolve. e.g.:
  //   User: "tell me about face verification"
  //   Bot:  <face verification answer>
  //   User: "and gps?"                     <- no verb, no "AttendX"
  //   Bot:  correctly answers about GPS, using the same *frame*
  //         (still talking about AttendX features) as the previous turn.
  //
  // This is intentionally simple (last-topic memory + pronoun/ellipsis
  // detection), not a full dialogue-state tracker — that's the right
  // amount of complexity for a self-hosted FAQ+data bot.
  // ==========================================================
  function ConversationContext() {
    this.turns = []; // { text, matchedEntryId, timestamp }
    this.lastEntryId = null;
    this.lastTopicTokens = [];
  }

  ConversationContext.prototype.record = function (userText, matchedEntryId) {
    this.turns.push({ text: userText, matchedEntryId, timestamp: Date.now() });
    if (matchedEntryId) this.lastEntryId = matchedEntryId;
    this.lastTopicTokens = tokenize(userText);
    if (this.turns.length > 12) this.turns.shift(); // keep it bounded
  };

  // Returns true if the current message looks like a short follow-up
  // ("and gps?", "what about lecturers", "what does that mean") rather
  // than a fresh, self-contained question.
  ConversationContext.prototype.looksLikeFollowUp = function (userText) {
    const tokens = tokenize(userText);
    const normalized = normalize(userText);

    // Explicit connector/ellipsis phrasing is always a strong signal
    // regardless of length ("what about lecturers", "and how do I do
    // that for students").
    const startsWithConnector = /^(and|what about|what of|also|how about|and what about|that|it|those|then)\b/.test(normalized);
    if (startsWithConnector) return this.turns.length > 0;

    // Otherwise, only treat it as a follow-up if it's a BARE fragment —
    // 1-2 tokens with no question word of its own (e.g. "gps?", "face
    // verification"). A question that has its own question word
    // ("how", "what", "is", "can", "do") or is 3+ tokens is a
    // self-contained question and must be scored fresh, not blended
    // with the previous topic — otherwise a new topic like "how can I
    // register" incorrectly inherits the prior "pricing" context.
    const hasOwnQuestionWord = /^(how|what|when|where|why|who|is|are|do|does|can|could|will|would|should)\b/.test(normalized);
    const isBareFragment = tokens.length <= 2 && !hasOwnQuestionWord;

    return this.turns.length > 0 && isBareFragment;
  };

  // Merges the current short follow-up with the previous turn's topic
  // tokens, so downstream matching has more to work with. e.g.
  // "and gps?" after "tell me about face verification" becomes
  // effectively "gps face verification" for scoring purposes — the old
  // topic acts as context but the new token(s) still dominate.
  ConversationContext.prototype.expandWithContext = function (userText) {
    if (!this.looksLikeFollowUp(userText)) return userText;
    const currentTokens = tokenize(userText).join(" ");
    const contextTokens = this.lastTopicTokens.join(" ");
    return `${currentTokens} ${contextTokens}`.trim();
  };

  // ==========================================================
  // PUBLIC API
  // ==========================================================
  global.AttendXNLP = {
    normalize,
    tokenize,
    levenshtein,
    isFuzzyMatch,
    scoreQueryAgainstKeywords,
    findBestKnowledgeMatch,
    rankByRelevance,
    detectIntent,
    ConversationContext
  };

})(window);
// ai-lecturer-handlers.js
// Registers data-aware question handlers for the AttendX AI widget,
// scoped to the currently logged-in lecturer. Include this AFTER
// ai-nlp-engine.js, ai-chat-widget.js and firebase-config.js on
// lecturer-dashboard.html.
//
// Access is scoped the same way the dashboard itself is scoped — every
// query below filters by the logged-in lecturer's own uid, so the widget
// can never surface another lecturer's data. This scoping is UNCHANGED.
//
// UPGRADED: intent detection now uses ai-nlp-engine.js (typo/synonym
// tolerant) instead of raw regexes, and picking "which session the user
// means" now uses ranked relevance scoring across ALL of the lecturer's
// recent sessions instead of "first course name that's a substring
// match, else most recent."

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let currentLecturerUid = null;

onAuthStateChanged(auth, (user) => {
  currentLecturerUid = user ? user.uid : null;
});

// NLP engine is loaded as a plain script onto window before this module
// runs (see the required <script> order in the file header above).
const NLP = window.AttendXNLP;

// Finds the lecturer's most relevant session for this question: if the
// question names (or fuzzily/partially names) a course, that session
// wins; otherwise falls back to the most recent one, same as before.
async function findRelevantSession(questionText) {
  const sessionsQuery = query(
    collection(db, "sessions"),
    where("lecturerUid", "==", currentLecturerUid),
    orderBy("createdAt", "desc"),
    limit(20)
  );
  const snapshot = await getDocs(sessionsQuery);
  if (snapshot.empty) return null;

  const sessions = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (NLP) {
    const ranked = NLP.rankByRelevance(questionText, sessions, (s) => s.courseName || "");
    // Only prefer a ranked hit over "most recent" if it actually scored
    // (i.e. the question really did reference a course name/synonym).
    if (ranked.length && ranked[0].score > 0) {
      return ranked[0].item;
    }
    return sessions[0]; // most recent, since sessions[] is already ordered desc
  }

  // Defensive fallback if the engine didn't load.
  const normalized = questionText.toLowerCase();
  const mentioned = sessions.find((s) => s.courseName && normalized.includes(s.courseName.toLowerCase()));
  return mentioned || sessions[0];
}

async function countCheckIns(sessionId) {
  const checkInsQuery = query(
    collection(db, "checkIns"),
    where("sessionId", "==", sessionId)
  );
  const snapshot = await getDocs(checkInsQuery);
  return snapshot.size;
}

if (window.AttendXAI) {
  window.AttendXAI.registerDataHandler(async (questionText, conversation) => {
    if (!currentLecturerUid) return null; // not logged in yet

    // Blend short follow-ups ("and how many for that one?") with the
    // previous turn's topic before running intent detection.
    const effectiveText = conversation ? conversation.expandWithContext(questionText) : questionText;
    const intent = NLP ? NLP.detectIntent(effectiveText) : null;

    // Fallback regex intent if the engine somehow isn't present, so the
    // handler still degrades gracefully rather than going fully silent.
    const q = effectiveText.toLowerCase();
    const asksHowMany = intent ? intent.wantsCount : /how many|number of|count/.test(q);
    const asksAttendance = intent ? intent.mentionsAttendance : /student|attend|check.?in|present/.test(q);
    const asksActive = intent ? intent.wantsOngoing : /active session|current session|is my session/.test(q);
    const asksLatest = intent ? intent.wantsRecent : /latest|last|most recent|current/.test(q);
    const asksSession = intent ? intent.mentionsSession : /session/.test(q);

    // "How many students checked in / marked attendance [for X]?"
    if (asksHowMany && asksAttendance) {
      const session = await findRelevantSession(effectiveText);
      if (!session) {
        return "You haven't created any sessions yet, so there's no attendance to report.";
      }
      const count = await countCheckIns(session.id);
      const statusText = session.active ? "so far" : "in total";
      return `${count} student${count === 1 ? "" : "s"} checked in ${statusText} for "${session.courseName || "your session"}".`;
    }

    // "Is my session active / do I have an active session?"
    if (asksActive) {
      const sessionsQuery = query(
        collection(db, "sessions"),
        where("lecturerUid", "==", currentLecturerUid),
        where("active", "==", true),
        limit(5)
      );
      const snapshot = await getDocs(sessionsQuery);
      if (snapshot.empty) {
        return "You don't have any active sessions right now.";
      }
      const names = snapshot.docs.map((d) => d.data().courseName || "Untitled session").join(", ");
      return `You have an active session for: ${names}.`;
    }

    // "What's my latest session?"
    if (asksLatest && asksSession) {
      const session = await findRelevantSession(effectiveText);
      if (!session) return "You haven't created any sessions yet.";
      const count = await countCheckIns(session.id);
      return `Your most recent session was "${session.courseName || "Untitled session"}" — ${session.active ? "still active" : "ended"}, with ${count} check-in${count === 1 ? "" : "s"}.`;
    }

    return null; // not a data question this handler understands
  });

  window.AttendXAI.setQuickReplies([
    { label: "Students checked in?", query: "how many students checked in to my latest session" },
    { label: "Active session?", query: "do I have an active session" },
    { label: "How does it work?", query: "how does it work" },
    { label: "Export reports", query: "export csv" }
  ]);

  window.AttendXAI.setWelcomeMessage(
    "Hi! I'm AttendX AI 🎓 Ask me about your sessions and attendance — e.g. \"how many students checked in?\" — or general questions about AttendX."
  );
}
// ai-lecturer-handlers.js
// Registers data-aware question handlers for the AttendX AI widget,
// scoped to the currently logged-in lecturer. Include this AFTER
// ai-chat-widget.js and firebase-config.js on lecturer-dashboard.html.
//
// Access is scoped the same way the dashboard itself is scoped — every
// query below filters by the logged-in lecturer's own uid, so the widget
// can never surface another lecturer's data.

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

function normalize(text) {
  return text.toLowerCase().trim();
}

// Finds the lecturer's most recent session, optionally filtered by a
// course name mentioned in the question.
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

  // If the question mentions a course name that matches one of the
  // lecturer's sessions, prefer that session over the most recent one.
  const mentioned = sessions.find((s) =>
    s.courseName && normalize(questionText).includes(normalize(s.courseName))
  );

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
  window.AttendXAI.registerDataHandler(async (questionText) => {
    if (!currentLecturerUid) return null; // not logged in yet
    const q = normalize(questionText);

    const asksHowMany = /how many|number of|count/.test(q);
    const asksAttendance = /student|attend|check.?in|present/.test(q);
    const asksActive = /active session|current session|is my session/.test(q);
    const asksLatest = /latest|last|most recent|current/.test(q);

    // "How many students checked in / marked attendance [for X]?"
    if (asksHowMany && asksAttendance) {
      const session = await findRelevantSession(questionText);
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
    if (asksLatest && /session/.test(q)) {
      const session = await findRelevantSession(questionText);
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
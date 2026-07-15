// ai-student-handlers.js
// Registers data-aware question handlers for the AttendX AI widget,
// scoped to the currently logged-in student's own attendance history.
// Include this AFTER ai-chat-widget.js and firebase-config.js on
// student-dashboard.html.

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

let currentStudentUid = null;

onAuthStateChanged(auth, (user) => {
  currentStudentUid = user ? user.uid : null;
});

function normalize(text) {
  return text.toLowerCase().trim();
}

if (window.AttendXAI) {
  window.AttendXAI.registerDataHandler(async (questionText) => {
    if (!currentStudentUid) return null;
    const q = normalize(questionText);

    const asksHowMany = /how many|number of|count/.test(q);
    const asksSessions = /session|class|check.?in|attend/.test(q);
    const asksLatest = /latest|last|most recent|when.*(last|latest)/.test(q);
    const asksToday = /today/.test(q);

    // "How many sessions have I attended?"
    if (asksHowMany && asksSessions) {
      const checkInsQuery = query(
        collection(db, "checkIns"),
        where("studentUid", "==", currentStudentUid),
        limit(1000)
      );
      const snapshot = await getDocs(checkInsQuery);
      return `You've checked in to ${snapshot.size} session${snapshot.size === 1 ? "" : "s"} in total.`;
    }

    // "Have I checked in today?"
    if (asksToday && asksSessions) {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const checkInsQuery = query(
        collection(db, "checkIns"),
        where("studentUid", "==", currentStudentUid),
        orderBy("checkedInAt", "desc"),
        limit(10)
      );
      const snapshot = await getDocs(checkInsQuery);

      const todayCheckIns = snapshot.docs.filter((d) => {
        const data = d.data();
        return data.checkedInAt && data.checkedInAt.toDate && data.checkedInAt.toDate() >= startOfToday;
      });

      if (todayCheckIns.length === 0) {
        return "You haven't checked in to any sessions today yet.";
      }
      const names = todayCheckIns.map((d) => d.data().courseName || "a session").join(", ");
      return `Yes — you've checked in today for: ${names}.`;
    }

    // "What was my latest check-in?"
    if (asksLatest && asksSessions) {
      const checkInsQuery = query(
        collection(db, "checkIns"),
        where("studentUid", "==", currentStudentUid),
        orderBy("checkedInAt", "desc"),
        limit(1)
      );
      const snapshot = await getDocs(checkInsQuery);
      if (snapshot.empty) return "You haven't checked in to any sessions yet.";

      const data = snapshot.docs[0].data();
      const timeText = data.checkedInAt && data.checkedInAt.toDate
        ? data.checkedInAt.toDate().toLocaleString()
        : "recently";
      return `Your most recent check-in was for "${data.courseName || "a session"}" on ${timeText}.`;
    }

    return null;
  });

  window.AttendXAI.setQuickReplies([
    { label: "Total check-ins?", query: "how many sessions have I attended" },
    { label: "Checked in today?", query: "have I checked in today" },
    { label: "Latest check-in?", query: "what was my latest check-in" },
    { label: "How does it work?", query: "how does it work" }
  ]);

  window.AttendXAI.setWelcomeMessage(
    "Hi! I'm AttendX AI 🎓 Ask me about your attendance — e.g. \"have I checked in today?\" — or general questions about AttendX."
  );
}
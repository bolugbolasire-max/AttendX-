// ai-school-admin-handlers.js
// Registers data-aware question handlers for the AttendX AI widget,
// scoped to the currently logged-in school admin's own school. Include
// this AFTER ai-chat-widget.js and firebase-config.js on
// school-admin-dashboard.html.
//
// Every query below filters by the admin's own schoolId, matching the
// same scoping the dashboard itself already uses.

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
  limit
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let currentSchoolId = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentSchoolId = null;
    return;
  }
  try {
    const userDocSnap = await getDoc(doc(db, "users", user.uid));
    if (userDocSnap.exists()) {
      currentSchoolId = userDocSnap.data().schoolId || null;
    }
  } catch (error) {
    console.error("AI widget: error resolving school admin's schoolId:", error);
  }
});

function normalize(text) {
  return text.toLowerCase().trim();
}

if (window.AttendXAI) {
  window.AttendXAI.registerDataHandler(async (questionText) => {
    if (!currentSchoolId) return null; // not logged in / not resolved yet
    const q = normalize(questionText);

    const asksHowMany = /how many|number of|count/.test(q);
    const asksLecturers = /lecturer/.test(q);
    const asksCourses = /course/.test(q);
    const asksPending = /pending|awaiting|request/.test(q);
    const asksSessions = /session/.test(q);

    // "How many lecturers do we have?"
    if (asksHowMany && asksLecturers) {
      const lecturersQuery = query(
        collection(db, "users"),
        where("role", "==", "lecturer"),
        where("schoolId", "==", currentSchoolId),
        limit(500)
      );
      const snapshot = await getDocs(lecturersQuery);
      return `Your school has ${snapshot.size} lecturer${snapshot.size === 1 ? "" : "s"} registered.`;
    }

    // "How many courses do we have?"
    if (asksHowMany && asksCourses && !asksPending) {
      const coursesQuery = query(
        collection(db, "courses"),
        where("schoolId", "==", currentSchoolId),
        limit(500)
      );
      const snapshot = await getDocs(coursesQuery);
      return `Your school has ${snapshot.size} course${snapshot.size === 1 ? "" : "s"} set up.`;
    }

    // "How many pending course requests?" / "any pending requests?"
    if (asksPending && (asksCourses || /request/.test(q))) {
      const requestsQuery = query(
        collection(db, "courseRequests"),
        where("schoolId", "==", currentSchoolId),
        where("status", "==", "pending"),
        limit(500)
      );
      const snapshot = await getDocs(requestsQuery);
      if (snapshot.empty) return "There are no pending course requests right now.";
      return `You have ${snapshot.size} pending course request${snapshot.size === 1 ? "" : "s"} waiting for review.`;
    }

    // "How many sessions have been held?"
    if (asksHowMany && asksSessions) {
      const sessionsQuery = query(
        collection(db, "sessions"),
        where("schoolId", "==", currentSchoolId),
        limit(1000)
      );
      const snapshot = await getDocs(sessionsQuery);
      return `${snapshot.size} session${snapshot.size === 1 ? " has" : "s have"} been created at your school so far.`;
    }

    return null;
  });

  window.AttendXAI.setQuickReplies([
    { label: "How many lecturers?", query: "how many lecturers do we have" },
    { label: "Pending requests?", query: "how many pending course requests" },
    { label: "How many courses?", query: "how many courses do we have" },
    { label: "How does it work?", query: "how does it work" }
  ]);

  window.AttendXAI.setWelcomeMessage(
    "Hi! I'm AttendX AI 🏫 Ask me about your school — e.g. \"how many lecturers do we have?\" — or general questions about AttendX."
  );
}
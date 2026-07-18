// ai-super-admin-handlers.js
// Registers data-aware question handlers for the AttendX AI widget,
// scoped to platform-wide data the Super Admin is allowed to see.
// Include this AFTER ai-nlp-engine.js, ai-chat-widget.js and
// firebase-config.js on super-admin-dashboard.html.
//
// UPGRADED: intent detection goes through ai-nlp-engine.js for typo/
// synonym tolerance ("how many schools are live" -> "active" via the
// engine's synonym map).

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  getDocs,
  query,
  where,
  limit
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let isSuperAdminLoggedIn = false;

onAuthStateChanged(auth, (user) => {
  isSuperAdminLoggedIn = !!user;
});

const NLP = window.AttendXNLP;

if (window.AttendXAI) {
  window.AttendXAI.registerDataHandler(async (questionText, conversation) => {
    if (!isSuperAdminLoggedIn) return null;

    const effectiveText = conversation ? conversation.expandWithContext(questionText) : questionText;
    const intent = NLP ? NLP.detectIntent(effectiveText) : null;

    const q = effectiveText.toLowerCase();
    const asksHowMany = intent ? intent.wantsCount : /how many|number of|count/.test(q);
    const asksSchools = intent ? intent.mentionsSchool : /school/.test(q);
    const asksActive = intent ? intent.wantsOngoing : /active/.test(q);
    const asksAdmins = intent ? intent.mentionsAdministrator : /admin/.test(q);

    // "How many schools are active?"
    if (asksHowMany && asksSchools && asksActive) {
      const schoolsSnapshot = await getDocs(collection(db, "schools"));
      let activeCount = 0;
      schoolsSnapshot.forEach((docSnap) => {
        if (docSnap.data().status === "active") activeCount++;
      });
      return `${activeCount} of ${schoolsSnapshot.size} schools on the platform are currently active.`;
    }

    // "How many schools do we have?"
    if (asksHowMany && asksSchools) {
      const schoolsSnapshot = await getDocs(collection(db, "schools"));
      return `There are ${schoolsSnapshot.size} school${schoolsSnapshot.size === 1 ? "" : "s"} on the platform.`;
    }

    // "How many school admins?"
    if (asksHowMany && asksAdmins) {
      const adminsQuery = query(collection(db, "users"), where("role", "==", "schooladmin"), limit(1000));
      const snapshot = await getDocs(adminsQuery);
      return `There are ${snapshot.size} School Admin account${snapshot.size === 1 ? "" : "s"} on the platform.`;
    }

    return null;
  });

  window.AttendXAI.setQuickReplies([
    { label: "How many schools?", query: "how many schools do we have" },
    { label: "Active schools?", query: "how many active schools" },
    { label: "School admins?", query: "how many school admins" },
    { label: "How does it work?", query: "how does it work" }
  ]);

  window.AttendXAI.setWelcomeMessage(
    "Hi! I'm AttendX AI 🛡️ Ask me about the platform — e.g. \"how many schools are active?\" — or general questions about AttendX."
  );
}
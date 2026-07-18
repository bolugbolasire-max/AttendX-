// ai-notifications.js
// Student dashboard notification bell — in-app only (no push yet).
// Self-contained: builds its own DOM (bell + dropdown), listens live to
// Firestore, and cleans up old read notifications automatically.
//
// Include this AFTER firebase-config.js on student-dashboard.html:
//   <script type="module" src="ai-notifications.js"></script>
//
// DATA MODEL (Firestore collection: "notifications")
//   studentUid   : string   — which student this belongs to
//   type         : "session-started" | "attendance-marked"
//   title        : string   — short heading, e.g. "New session started"
//   body         : string   — detail text, e.g. course name
//   courseName   : string   (optional)
//   read         : boolean  — false until the student opens/clicks it
//   createdAt    : Firestore Timestamp
//   readAt       : Firestore Timestamp | null — set when marked read
//
// WHO WRITES THESE DOCS: this file only READS and marks-as-read. The
// docs themselves get created elsewhere — from lecturer-dashboard.js
// when a session starts (notify enrolled students), and from
// student-dashboard.js when a check-in succeeds (notify that student).
// That wiring happens in a separate step once those files are shared.

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const READ_RETENTION_DAYS = 7;
const MAX_NOTIFICATIONS_SHOWN = 30;

let currentStudentUid = null;
let unsubscribeListener = null;
let latestDocs = []; // cached { id, ...data } for render + cleanup

// ==========================
// DOM
// ==========================
function buildBellUI() {
  const headerUserEl = document.querySelector(".header-user");
  if (!headerUserEl) {
    console.warn("ai-notifications: .header-user element not found, skipping bell UI.");
    return null;
  }

  const wrap = document.createElement("div");
  wrap.id = "notifBellWrap";
  wrap.style.position = "relative";
  wrap.style.display = "inline-flex";
  wrap.style.marginRight = "10px";

  wrap.innerHTML = `
    <button id="notifBellBtn" type="button" aria-label="Notifications" style="
      position: relative;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 50%;
      width: 40px;
      height: 40px;
      font-size: 1.1rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s ease, background 0.2s ease;
    ">
      🔔
      <span id="notifBadge" style="
        display: none;
        position: absolute;
        top: -4px;
        right: -4px;
        min-width: 18px;
        height: 18px;
        padding: 0 4px;
        border-radius: 9px;
        background: #e11d48;
        color: #fff;
        font-size: 0.68rem;
        font-weight: 700;
        line-height: 18px;
        text-align: center;
        border: 2px solid var(--bg);
      ">0</span>
    </button>

    <div id="notifDropdown" style="
      display: none;
      position: absolute;
      top: 48px;
      right: 0;
      width: 320px;
      max-width: calc(100vw - 32px);
      max-height: 420px;
      overflow-y: auto;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: 0 16px 40px rgba(31, 41, 96, 0.18);
      z-index: 1200;
    ">
      <div style="
        padding: 14px 16px;
        border-bottom: 1px solid var(--border);
        font-weight: 600;
        font-size: 0.9rem;
        color: var(--text);
      ">Notifications</div>
      <div id="notifList" style="display: flex; flex-direction: column;"></div>
    </div>
  `;

  headerUserEl.parentElement.insertBefore(wrap, headerUserEl);
  return wrap;
}

function renderEmptyState() {
  return `<p style="padding: 24px 16px; text-align: center; color: var(--text-light); font-size: 0.85rem;">No notifications yet.</p>`;
}

function iconFor(type) {
  if (type === "session-started") return "🟢";
  if (type === "attendance-marked") return "✅";
  return "🔔";
}

function timeAgo(timestamp) {
  if (!timestamp || !timestamp.toDate) return "";
  const diffMs = Date.now() - timestamp.toDate().getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function renderNotifications(listEl, docs) {
  if (!docs.length) {
    listEl.innerHTML = renderEmptyState();
    return;
  }

  listEl.innerHTML = docs
    .map((n) => {
      const unread = !n.read;
      return `
        <button type="button" class="notif-item" data-id="${n.id}" style="
          display: flex;
          gap: 10px;
          align-items: flex-start;
          width: 100%;
          text-align: left;
          padding: 12px 16px;
          border: none;
          border-bottom: 1px solid var(--border);
          background: ${unread ? "rgba(47, 111, 237, 0.06)" : "transparent"};
          cursor: pointer;
          font-family: inherit;
        ">
          <span style="font-size: 1.1rem; flex-shrink: 0;">${iconFor(n.type)}</span>
          <span style="flex: 1; min-width: 0;">
            <span style="display: block; font-size: 0.85rem; font-weight: ${unread ? "600" : "500"}; color: var(--text);">${escapeHtml(n.title || "Notification")}</span>
            ${n.body ? `<span style="display: block; font-size: 0.78rem; color: var(--text-light); margin-top: 2px;">${escapeHtml(n.body)}</span>` : ""}
            <span style="display: block; font-size: 0.7rem; color: var(--text-light); margin-top: 4px;">${timeAgo(n.createdAt)}</span>
          </span>
          ${unread ? `<span style="width: 8px; height: 8px; border-radius: 50%; background: var(--primary); flex-shrink: 0; margin-top: 4px;"></span>` : ""}
        </button>
      `;
    })
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function updateBadge(badgeEl, unreadCount) {
  if (unreadCount > 0) {
    badgeEl.style.display = "block";
    badgeEl.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
  } else {
    badgeEl.style.display = "none";
  }
}

// ==========================
// FIRESTORE
// ==========================
function startListening(studentUid, onUpdate) {
  const notifQuery = query(
    collection(db, "notifications"),
    where("studentUid", "==", studentUid),
    orderBy("createdAt", "desc"),
    limit(MAX_NOTIFICATIONS_SHOWN)
  );

  return onSnapshot(
    notifQuery,
    (snapshot) => {
      const docs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      onUpdate(docs);
    },
    (error) => {
      console.error("ai-notifications: listener error:", error);
    }
  );
}

async function markAsRead(notificationId) {
  try {
    await updateDoc(doc(db, "notifications", notificationId), {
      read: true,
      readAt: serverTimestamp()
    });
  } catch (error) {
    console.error("ai-notifications: failed to mark as read:", error);
  }
}

// Deletes any notification that's been read for more than
// READ_RETENTION_DAYS. Runs once per page load/listener update rather
// than on a timer — cheap, and catches up naturally next time the
// student opens the dashboard even if they weren't online for a while.
async function cleanupOldReadNotifications(docs) {
  const cutoff = Date.now() - READ_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const toDelete = docs.filter((n) => {
    if (!n.read || !n.readAt || !n.readAt.toDate) return false;
    return n.readAt.toDate().getTime() < cutoff;
  });

  for (const n of toDelete) {
    try {
      await deleteDoc(doc(db, "notifications", n.id));
    } catch (error) {
      console.error("ai-notifications: cleanup delete failed for", n.id, error);
    }
  }
}

// ==========================
// INIT
// ==========================
function initNotifications() {
  const ui = buildBellUI();
  if (!ui) return;

  const bellBtn = document.getElementById("notifBellBtn");
  const dropdown = document.getElementById("notifDropdown");
  const badge = document.getElementById("notifBadge");
  const listEl = document.getElementById("notifList");

  let isOpen = false;

  function openDropdown() {
    isOpen = true;
    dropdown.style.display = "block";
  }
  function closeDropdown() {
    isOpen = false;
    dropdown.style.display = "none";
  }

  bellBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    isOpen ? closeDropdown() : openDropdown();
  });

  document.addEventListener("click", (e) => {
    if (isOpen && !ui.contains(e.target)) closeDropdown();
  });

  listEl.addEventListener("click", (e) => {
    const item = e.target.closest(".notif-item");
    if (!item) return;
    const id = item.getAttribute("data-id");
    const notif = latestDocs.find((n) => n.id === id);
    if (notif && !notif.read) {
      markAsRead(id);
    }
  });

  onAuthStateChanged(auth, (user) => {
    if (unsubscribeListener) {
      unsubscribeListener();
      unsubscribeListener = null;
    }

    if (!user) {
      currentStudentUid = null;
      latestDocs = [];
      updateBadge(badge, 0);
      listEl.innerHTML = renderEmptyState();
      return;
    }

    currentStudentUid = user.uid;
    unsubscribeListener = startListening(currentStudentUid, (docs) => {
      latestDocs = docs;
      const unreadCount = docs.filter((n) => !n.read).length;
      updateBadge(badge, unreadCount);
      renderNotifications(listEl, docs);
      cleanupOldReadNotifications(docs);
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initNotifications);
} else {
  initNotifications();
}
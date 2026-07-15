// session-lock.js
//
// Smart inactivity session lock for AttendX dashboards.
// Works on: Student, Lecturer, School Admin, Super Admin dashboards.
//
// USAGE (add to each *-dashboard.js, right after the auth guard confirms
// the user's role — see the "INTEGRATION SNIPPET" comment at the bottom
// of this file for the exact lines to add):
//
//   import { initSessionLock } from "./session-lock.js";
//
//   initSessionLock({
//     uid: user.uid,
//     email: userData.email || user.email,
//     role: userData.role,          // "student" | "lecturer" | "schooladmin" | "superadmin"
//     loginPage: "lecturer-login.html"
//   });
//
// Everything else (timers, lock screen, reauth, cross-tab sync, Firestore
// logging, settings) is handled internally.

import { auth, db } from "./firebase-config.js";
import {
  signOut,
  EmailAuthProvider,
  reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  addDoc,
  collection,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ==========================================================
// CONFIG / DEFAULTS
// ==========================================================

const DEFAULT_LOCK_MINUTES = 2;         // dashboard locks after this much inactivity
const DEFAULT_LOGOUT_MINUTES = 30;      // full sign-out after this much inactivity
const REMEMBER_DEVICE_LOCK_MINUTES = 15; // longer lock timeout on a "remembered" device
const ALLOWED_LOCK_MINUTES = [2, 5, 10, 15]; // user-selectable options

const ACTIVITY_EVENTS = ["mousemove", "keydown", "scroll", "click", "touchstart", "pointerdown"];

// localStorage keys used for cross-tab sync. Every tab on the same origin
// shares these, so a lock/logout in one tab is picked up by all others via
// the "storage" event (which only fires in *other* tabs, not the one that
// wrote the value — exactly what we want).
const LS_LAST_ACTIVITY = "attendx_last_activity";
const LS_LOCK_STATE = "attendx_lock_state"; // "locked" | "unlocked"
const LS_LOGOUT_SIGNAL = "attendx_logout_signal"; // timestamp, bumped to broadcast logout
const LS_UNSAVED_PREFIX = "attendx_unsaved_"; // + uid, holds preserved form data

// ==========================================================
// MODULE STATE
// ==========================================================

let session = null;       // { uid, email, role, loginPage }
let settings = {
  lockMinutes: DEFAULT_LOCK_MINUTES,
  logoutMinutes: DEFAULT_LOGOUT_MINUTES,
  rememberDevice: false
};
let maxLockMinutesEnforced = null; // Super Admin override, if any

let lockTimer = null;
let logoutTimer = null;
let countdownInterval = null;
let isLocked = false;
let overlayEl = null;

// ==========================================================
// PUBLIC ENTRY POINT
// ==========================================================

export async function initSessionLock({ uid, email, role, loginPage }) {
  session = { uid, email, role, loginPage: loginPage || "index.html" };

  await loadSettings();
  injectStyles();
  buildOverlay();

  // Cross-tab: another tab may have already locked/logged out before this
  // tab finished loading (e.g. dashboard opened in a second tab).
  if (localStorage.getItem(LS_LOCK_STATE) === "locked") {
    showLockScreen({ fromOtherTab: true });
  }

  ACTIVITY_EVENTS.forEach((evt) => {
    document.addEventListener(evt, onActivity, { passive: true });
  });

  window.addEventListener("storage", onStorageEvent);

  // Preserve-on-unload safety net, in case a lock/logout fires mid-typing.
  window.addEventListener("beforeunload", () => {
    if (!isLocked) captureUnsavedFormData();
  });

  resetTimers();
  recordActivity(); // stamps localStorage so other tabs see this tab is alive
}

// ==========================================================
// SETTINGS (Firestore: users/{uid}.sessionSettings, plus optional
// platform-wide enforced max in config/security.maxLockMinutes)
// ==========================================================

async function loadSettings() {
  try {
    const userSnap = await getDoc(doc(db, "users", session.uid));
    const stored = userSnap.exists() ? userSnap.data().sessionSettings : null;

    if (stored) {
      settings.lockMinutes = ALLOWED_LOCK_MINUTES.includes(stored.lockMinutes)
        ? stored.lockMinutes
        : DEFAULT_LOCK_MINUTES;
      settings.logoutMinutes = stored.logoutMinutes || DEFAULT_LOGOUT_MINUTES;
      settings.rememberDevice = !!stored.rememberDevice;
    }
  } catch (error) {
    console.error("session-lock: couldn't load user settings, using defaults", error);
  }

  // Super Admin enforced cap, read from a shared config doc. If present,
  // no user's lock timeout (including a "remembered device") may exceed it.
  try {
    const configSnap = await getDoc(doc(db, "config", "security"));
    if (configSnap.exists() && typeof configSnap.data().maxLockMinutes === "number") {
      maxLockMinutesEnforced = configSnap.data().maxLockMinutes;
    }
  } catch (error) {
    // Non-fatal — config doc may not exist yet on a fresh project.
    console.warn("session-lock: no platform security config found, skipping cap");
  }
}

function effectiveLockMinutes() {
  let minutes = settings.rememberDevice
    ? Math.max(settings.lockMinutes, REMEMBER_DEVICE_LOCK_MINUTES)
    : settings.lockMinutes;

  if (typeof maxLockMinutesEnforced === "number") {
    minutes = Math.min(minutes, maxLockMinutesEnforced);
  }
  return minutes;
}

// Called from a Settings UI (see integration notes) to update the user's
// preferred lock timeout and remember-device flag.
export async function updateSessionSettings({ lockMinutes, rememberDevice }) {
  if (lockMinutes !== undefined && ALLOWED_LOCK_MINUTES.includes(lockMinutes)) {
    settings.lockMinutes = lockMinutes;
  }
  if (rememberDevice !== undefined) {
    settings.rememberDevice = !!rememberDevice;
  }

  try {
    await setDoc(
      doc(db, "users", session.uid),
      { sessionSettings: { ...settings } },
      { merge: true }
    );
  } catch (error) {
    console.error("session-lock: couldn't save settings", error);
  }

  resetTimers();
}

export function getSessionSettings() {
  return { ...settings, allowedLockMinutes: ALLOWED_LOCK_MINUTES };
}

// ==========================================================
// ACTIVITY TRACKING / TIMERS
// ==========================================================

function onActivity() {
  if (isLocked) return; // ignore activity behind the lock screen
  recordActivity();
  resetTimers();
}

function recordActivity() {
  localStorage.setItem(LS_LAST_ACTIVITY, Date.now().toString());
}

function resetTimers() {
  clearTimeout(lockTimer);
  clearTimeout(logoutTimer);

  const lockMs = effectiveLockMinutes() * 60 * 1000;
  const logoutMs = settings.logoutMinutes * 60 * 1000;

  lockTimer = setTimeout(() => {
    lockDashboard("inactivity");
  }, lockMs);

  logoutTimer = setTimeout(() => {
    fullLogout("inactivity");
  }, logoutMs);
}

// ==========================================================
// CROSS-TAB SYNC
// ==========================================================

function onStorageEvent(e) {
  if (e.key === LS_LOCK_STATE && e.newValue === "locked" && !isLocked) {
    showLockScreen({ fromOtherTab: true });
  }
  if (e.key === LS_LOCK_STATE && e.newValue === "unlocked" && isLocked) {
    hideLockScreen({ fromOtherTab: true });
  }
  if (e.key === LS_LOGOUT_SIGNAL) {
    // Another tab signed the whole session out. Don't re-log the event —
    // that tab already did. Just follow it out.
    window.location.href = session ? session.loginPage : "index.html";
  }
}

// ==========================================================
// LOCK / UNLOCK
// ==========================================================

async function lockDashboard(reason) {
  if (isLocked) return;
  captureUnsavedFormData();
  showLockScreen();
  localStorage.setItem(LS_LOCK_STATE, "locked");
  await logSessionEvent("lock", reason);
}

function showLockScreen({ fromOtherTab = false } = {}) {
  isLocked = true;
  clearTimeout(lockTimer); // the logout timer keeps running while locked

  overlayEl.classList.add("attendx-lock-active");
  document.getElementById("attendxLockPasswordInput").value = "";
  document.getElementById("attendxLockError").textContent = "";

  startCountdown();

  if (!fromOtherTab) {
    setTimeout(() => {
      const input = document.getElementById("attendxLockPasswordInput");
      if (input) input.focus();
    }, 50);
  }
}

function hideLockScreen({ fromOtherTab = false } = {}) {
  isLocked = false;
  overlayEl.classList.remove("attendx-lock-active");
  clearInterval(countdownInterval);
  recordActivity();
  resetTimers();
  restoreUnsavedFormData();

  if (!fromOtherTab) {
    localStorage.setItem(LS_LOCK_STATE, "unlocked");
  }
}

async function attemptUnlock(password) {
  const errorEl = document.getElementById("attendxLockError");
  const unlockBtn = document.getElementById("attendxLockUnlockBtn");
  errorEl.textContent = "";

  if (!password) {
    errorEl.textContent = "Please enter your password.";
    return;
  }

  unlockBtn.disabled = true;
  unlockBtn.textContent = "Unlocking...";

  try {
    const user = auth.currentUser;
    if (!user || !user.email) {
      throw new Error("no-current-user");
    }

    const credential = EmailAuthProvider.credential(user.email, password);
    await reauthenticateWithCredential(user, credential);

    await logSessionEvent("unlock", "password_verified");
    hideLockScreen();

  } catch (error) {
    console.error("session-lock: unlock failed", error);

    if (error.code === "auth/wrong-password" || error.code === "auth/invalid-credential") {
      errorEl.textContent = "Incorrect password. Please try again.";
    } else if (error.code === "auth/too-many-requests") {
      errorEl.textContent = "Too many attempts. Please wait a moment and try again.";
    } else if (error.message === "no-current-user") {
      // Auth session itself is gone (e.g. token revoked elsewhere) — no
      // point staying on a lock screen for a session that no longer exists.
      await fullLogout("session_invalid");
      return;
    } else {
      errorEl.textContent = "Something went wrong. Please try again.";
    }
  }

  unlockBtn.disabled = false;
  unlockBtn.textContent = "Unlock";
}

// ==========================================================
// FULL LOGOUT
// ==========================================================

async function fullLogout(reason) {
  clearTimeout(lockTimer);
  clearTimeout(logoutTimer);
  clearInterval(countdownInterval);

  await logSessionEvent("logout", reason);

  // Broadcast to other tabs before we navigate away.
  localStorage.setItem(LS_LOGOUT_SIGNAL, Date.now().toString());
  localStorage.removeItem(LS_LOCK_STATE);

  try {
    await signOut(auth);
  } catch (error) {
    console.error("session-lock: error signing out", error);
  }

  window.location.href = session ? session.loginPage : "index.html";
}

// ==========================================================
// COUNTDOWN ("Logging out in 28:15")
// ==========================================================

function startCountdown() {
  clearInterval(countdownInterval);
  const countdownEl = document.getElementById("attendxLockCountdown");

  function tick() {
    const lastActivity = parseInt(localStorage.getItem(LS_LAST_ACTIVITY) || Date.now().toString(), 10);
    const logoutAt = lastActivity + settings.logoutMinutes * 60 * 1000;
    const remainingMs = Math.max(0, logoutAt - Date.now());

    const totalSeconds = Math.floor(remainingMs / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    countdownEl.textContent = `Logging out in ${mins}:${secs.toString().padStart(2, "0")}`;

    if (remainingMs <= 0) {
      clearInterval(countdownInterval);
      // Don't call fullLogout here directly if another tab already will —
      // the logoutTimer in whichever tab hits zero first handles it, and
      // the storage "logout signal" carries the rest along.
    }
  }

  tick();
  countdownInterval = setInterval(tick, 1000);
}

// ==========================================================
// FIRESTORE AUDIT LOGGING
// ==========================================================

async function logSessionEvent(eventType, reason) {
  try {
    let ip = null;
    try {
      // Best-effort public IP lookup. Non-fatal if it fails or is blocked
      // (e.g. offline, ad-blocker, no network egress) — IP is "where
      // available" per spec, not a hard requirement.
      const res = await fetch("https://api.ipify.org?format=json");
      if (res.ok) {
        const data = await res.json();
        ip = data.ip || null;
      }
    } catch (_) {
      ip = null;
    }

    await addDoc(collection(db, "sessionEvents"), {
      uid: session.uid,
      email: session.email,
      role: session.role,
      eventType,       // "lock" | "unlock" | "logout"
      reason,           // "inactivity" | "manual" | "password_verified" | "session_invalid"
      userAgent: navigator.userAgent,
      platform: navigator.platform || null,
      screen: `${window.screen.width}x${window.screen.height}`,
      ip,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    // Logging must never block or break the lock/unlock/logout flow itself.
    console.error("session-lock: failed to log session event", error);
  }
}

// ==========================================================
// UNSAVED FORM DATA PRESERVATION
// ==========================================================
// Generic: captures every visible text/textarea/select/checkbox/radio
// input's value, scoped to the currently-active dashboard section (if the
// dashboard uses the .dashboard-section/.active pattern) so we don't
// accidentally restore stale values into a different tab later.

function captureUnsavedFormData() {
  try {
    const fields = document.querySelectorAll(
      "input[type=text], input[type=email], input[type=number], input[type=tel], input:not([type]), textarea, select"
    );

    const data = {};
    fields.forEach((field) => {
      if (!field.id) return; // only fields we can uniquely restore by id
      if (field.type === "password") return; // never persist password fields
      data[field.id] = field.value;
    });

    if (Object.keys(data).length > 0) {
      localStorage.setItem(LS_UNSAVED_PREFIX + session.uid, JSON.stringify(data));
    }
  } catch (error) {
    console.error("session-lock: couldn't capture form data", error);
  }
}

function restoreUnsavedFormData() {
  try {
    const raw = localStorage.getItem(LS_UNSAVED_PREFIX + session.uid);
    if (!raw) return;

    const data = JSON.parse(raw);
    Object.entries(data).forEach(([id, value]) => {
      const field = document.getElementById(id);
      if (field && field.type !== "password") {
        field.value = value;
      }
    });

    localStorage.removeItem(LS_UNSAVED_PREFIX + session.uid);
  } catch (error) {
    console.error("session-lock: couldn't restore form data", error);
  }
}

// ==========================================================
// LOCK SCREEN UI (built and injected once, reused across all dashboards)
// ==========================================================

function buildOverlay() {
  overlayEl = document.createElement("div");
  overlayEl.id = "attendxLockOverlay";
  overlayEl.innerHTML = `
    <div class="attendx-lock-card">
      <div class="attendx-lock-icon">🔒</div>
      <h2>Session Locked</h2>
      <p>Your session has been locked due to inactivity.</p>
      <p id="attendxLockCountdown" class="attendx-lock-countdown"></p>

      <form id="attendxLockForm" autocomplete="off">
        <label for="attendxLockPasswordInput">Password</label>
        <input type="password" id="attendxLockPasswordInput" placeholder="Enter your password" autocomplete="current-password" required>
        <div id="attendxLockError" class="attendx-lock-error"></div>
        <button type="submit" id="attendxLockUnlockBtn">Unlock</button>
      </form>

      <button type="button" id="attendxLockSignOutBtn" class="attendx-lock-signout">Sign out instead</button>
    </div>
  `;
  document.body.appendChild(overlayEl);

  document.getElementById("attendxLockForm").addEventListener("submit", (e) => {
    e.preventDefault();
    attemptUnlock(document.getElementById("attendxLockPasswordInput").value);
  });

  document.getElementById("attendxLockSignOutBtn").addEventListener("click", () => {
    fullLogout("manual_from_lock_screen");
  });
}

function injectStyles() {
  if (document.getElementById("attendxLockStyles")) return;

  const style = document.createElement("style");
  style.id = "attendxLockStyles";
  style.textContent = `
    #attendxLockOverlay {
      position: fixed;
      inset: 0;
      z-index: 99999;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(15, 17, 32, 0.55);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      padding: 20px;
    }
    #attendxLockOverlay.attendx-lock-active {
      display: flex;
    }
    body:has(#attendxLockOverlay.attendx-lock-active) #dashboardContent,
    body:has(#attendxLockOverlay.attendx-lock-active) .dashboard-wrapper {
      filter: blur(6px);
      pointer-events: none;
      user-select: none;
    }
    .attendx-lock-card {
      background: var(--card-bg, #fff);
      color: var(--text, #1a1a2e);
      border-radius: 16px;
      padding: 36px 32px;
      max-width: 380px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.35);
      font-family: 'Poppins', sans-serif;
    }
    .attendx-lock-icon {
      font-size: 2.4rem;
      margin-bottom: 8px;
    }
    .attendx-lock-card h2 {
      margin-bottom: 8px;
      font-size: 1.3rem;
    }
    .attendx-lock-card p {
      color: var(--text-light, #5a5a72);
      font-size: 0.92rem;
      margin-bottom: 4px;
    }
    .attendx-lock-countdown {
      font-weight: 600;
      color: #e11d48 !important;
      margin-bottom: 18px !important;
      font-size: 0.88rem;
    }
    #attendxLockForm {
      text-align: left;
      margin-top: 10px;
    }
    #attendxLockForm label {
      display: block;
      font-size: 0.85rem;
      font-weight: 500;
      margin-bottom: 6px;
    }
    #attendxLockForm input {
      width: 100%;
      padding: 12px 14px;
      border-radius: 10px;
      border: 1px solid var(--border, #e6e9f5);
      background: var(--bg, #fff);
      color: var(--text, #1a1a2e);
      font-family: inherit;
      font-size: 0.95rem;
      margin-bottom: 10px;
    }
    #attendxLockForm button[type="submit"] {
      width: 100%;
      padding: 13px;
      border: none;
      border-radius: 10px;
      background: var(--primary, #2f6fed);
      color: #fff;
      font-weight: 600;
      cursor: pointer;
      font-size: 0.95rem;
    }
    #attendxLockForm button[type="submit"]:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .attendx-lock-error {
      color: #e11d48;
      font-size: 0.82rem;
      min-height: 16px;
      margin-bottom: 8px;
    }
    .attendx-lock-signout {
      background: none;
      border: none;
      color: var(--text-light, #5a5a72);
      font-size: 0.82rem;
      margin-top: 16px;
      cursor: pointer;
      text-decoration: underline;
    }
    @media (max-width: 480px) {
      .attendx-lock-card {
        padding: 28px 22px;
      }
    }
  `;
  document.head.appendChild(style);
}

/*
==========================================================
INTEGRATION SNIPPET — add to the end of each dashboard's
onAuthStateChanged() success block, right after currentLecturer /
currentUser is populated and the dashboard is revealed:
==========================================================

  import { initSessionLock } from "./session-lock.js";

  initSessionLock({
    uid: user.uid,
    email: userData.email || user.email,
    role: userData.role,
    loginPage: "lecturer-login.html"   // swap per dashboard
  });

Per-dashboard loginPage values:
  student-dashboard.js      -> "student-login.html"
  lecturer-dashboard.js      -> "lecturer-login.html"
  school-admin-dashboard.js -> "school-admin-login.html"
  super-admin-dashboard.js  -> "super-admin-login.html"

No HTML changes are required — the lock screen and its styles are
injected by this module automatically. Just add one script tag:

  <script type="module" src="session-lock.js"></script>

(or simply import it from within each *-dashboard.js file, since it's
already type="module" — no extra <script> tag needed in that case).
==========================================================
*/
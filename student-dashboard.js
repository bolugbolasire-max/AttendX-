// student-dashboard.js
import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  getDoc,
  addDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Maximum allowed distance (in meters) between the student and the
// lecturer's session location for a check-in to be accepted.
// NOTE: this is enforced client-side only (see conversation notes) —
// good enough to stop casual/accidental out-of-range check-ins, but a
// technically determined student could spoof their GPS to bypass it.
// Tamper-proof enforcement would need a Cloud Function.
const MAX_CHECKIN_DISTANCE_METERS = 100;

const loadingScreen = document.getElementById("loadingScreen");
const dashboardContent = document.getElementById("dashboardContent");
const welcomeMessage = document.getElementById("welcomeMessage");
const schoolLine = document.getElementById("schoolLine");
const userEmail = document.getElementById("userEmail");
const logoutBtn = document.getElementById("logoutBtn");

const totalCheckInsEl = document.getElementById("totalCheckIns");

const startScanBtn = document.getElementById("startScanBtn");
const stopScanBtn = document.getElementById("stopScanBtn");
const qrReaderContainer = document.getElementById("qrReaderContainer");
const checkinMessage = document.getElementById("checkinMessage");
const checkinResultCard = document.getElementById("checkinResultCard");
const checkinResultTitle = document.getElementById("checkinResultTitle");
const checkinResultText = document.getElementById("checkinResultText");
const scanAnotherBtn = document.getElementById("scanAnotherBtn");

const historyList = document.getElementById("historyList");

let currentStudent = null; // { uid, fullName, matricNumber, schoolId, schoolName }
let html5QrCode = null;
let isProcessingScan = false; // guards against double-processing the same scan

// ==========================
// AUTH GUARD
// ==========================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "student-login.html";
    return;
  }

  try {
    const userDocRef = doc(db, "users", user.uid);
    const userDocSnap = await getDoc(userDocRef);

    if (!userDocSnap.exists() || userDocSnap.data().role !== "student") {
      window.location.href = "student-login.html";
      return;
    }

    const userData = userDocSnap.data();

    currentStudent = {
      uid: user.uid,
      fullName: userData.fullName || "Student",
      matricNumber: userData.matricNumber || "",
      schoolId: userData.schoolId || "",
      schoolName: userData.schoolName || ""
    };

    welcomeMessage.textContent = `Welcome, ${userData.fullName || "Student"}`;
    schoolLine.textContent = userData.schoolName || "";
    userEmail.textContent = userData.email || user.email;

    loadingScreen.style.display = "none";
    dashboardContent.style.display = "flex";

    loadHistory();

  } catch (error) {
    console.error("Error loading dashboard:", error);
    window.location.href = "student-login.html";
  }
});

// ==========================
// LOGOUT
// ==========================
logoutBtn.addEventListener("click", async () => {
  try {
    if (html5QrCode) {
      try { await html5QrCode.stop(); } catch (e) { /* already stopped */ }
    }
    await signOut(auth);
    window.location.href = "student-login.html";
  } catch (error) {
    console.error("Error signing out:", error);
  }
});

// ==========================
// GPS HELPERS
// ==========================
function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported by this browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy
        });
      },
      (error) => {
        reject(error);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

// Haversine formula — distance in meters between two lat/lng points.
function distanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ==========================
// UI HELPERS
// ==========================
function showCheckinMessage(text, type) {
  checkinMessage.textContent = text;
  checkinMessage.className = `form-message ${type}`;
}

function showResult(title, text, isSuccess) {
  qrReaderContainer.style.display = "none";
  startScanBtn.style.display = "none";
  stopScanBtn.style.display = "none";
  checkinResultCard.style.display = "block";
  checkinResultTitle.textContent = title;
  checkinResultTitle.style.color = isSuccess ? "var(--secondary)" : "#e11d48";
  checkinResultText.textContent = text;
}

function resetCheckinView() {
  checkinResultCard.style.display = "none";
  startScanBtn.style.display = "block";
  stopScanBtn.style.display = "none";
  qrReaderContainer.style.display = "none";
  showCheckinMessage("", "");
  isProcessingScan = false;
}

scanAnotherBtn.addEventListener("click", resetCheckinView);

// ==========================
// QR SCANNING
// ==========================
startScanBtn.addEventListener("click", async () => {
  showCheckinMessage("", "");
  qrReaderContainer.style.display = "block";
  startScanBtn.style.display = "none";
  stopScanBtn.style.display = "block";

  html5QrCode = new Html5Qrcode("qrReader");

  try {
    await html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      onScanSuccess,
      () => { /* per-frame scan failures are normal, ignore */ }
    );
  } catch (error) {
    console.error("Error starting camera:", error);
    showCheckinMessage("Could not access camera. Please allow camera permission and try again.", "error");
    qrReaderContainer.style.display = "none";
    startScanBtn.style.display = "block";
    stopScanBtn.style.display = "none";
  }
});

stopScanBtn.addEventListener("click", async () => {
  await stopScanning();
  resetCheckinView();
});

async function stopScanning() {
  if (html5QrCode) {
    try {
      await html5QrCode.stop();
      html5QrCode.clear();
    } catch (e) {
      // scanner may already be stopped
    }
  }
}

async function onScanSuccess(decodedText) {
  if (isProcessingScan) return; // ignore repeat frames while we're processing
  isProcessingScan = true;

  await stopScanning();
  qrReaderContainer.style.display = "none";
  showCheckinMessage("Verifying your location...", "");

  const sessionId = decodedText.trim();

  try {
    await processCheckIn(sessionId);
  } catch (error) {
    console.error("Check-in error:", error);
    showResult("❌ Check-in Failed", error.message || "Something went wrong. Please try again.", false);
  }
}

// ==========================
// CHECK-IN LOGIC
// ==========================
async function processCheckIn(sessionId) {
  // 1. Look up the session
  const sessionRef = doc(db, "sessions", sessionId);
  const sessionSnap = await getDoc(sessionRef);

  if (!sessionSnap.exists()) {
    throw new Error("This QR code doesn't match a valid session. Ask your lecturer to check it.");
  }

  const session = sessionSnap.data();

  if (!session.active) {
    throw new Error("This session has already ended.");
  }

  if (session.schoolId && currentStudent.schoolId && session.schoolId !== currentStudent.schoolId) {
    throw new Error("This session belongs to a different school and isn't available to you.");
  }

  // 2. Prevent duplicate check-ins for the same session
  const existingQuery = query(
    collection(db, "checkIns"),
    where("sessionId", "==", sessionId),
    where("studentUid", "==", currentStudent.uid)
  );
  const existingSnap = await getDocs(existingQuery);

  if (!existingSnap.empty) {
    throw new Error("You've already checked in to this session.");
  }

  // 3. Capture GPS and check distance
  showCheckinMessage("Capturing your location...", "");
  const location = await getCurrentLocation();

  if (typeof session.latitude === "number" && typeof session.longitude === "number") {
    const distance = distanceInMeters(
      location.latitude, location.longitude,
      session.latitude, session.longitude
    );

    if (distance > MAX_CHECKIN_DISTANCE_METERS) {
      throw new Error(
        `You appear to be about ${Math.round(distance)}m from the session location. ` +
        `You need to be within ${MAX_CHECKIN_DISTANCE_METERS}m to check in.`
      );
    }
  }

  // 4. Write the check-in
  await addDoc(collection(db, "checkIns"), {
    sessionId,
    courseName: session.courseName || "",
    lecturerUid: session.lecturerUid || "",
    schoolId: session.schoolId || "",
    studentUid: currentStudent.uid,
    studentName: currentStudent.fullName,
    matricNumber: currentStudent.matricNumber,
    latitude: location.latitude,
    longitude: location.longitude,
    checkedInAt: serverTimestamp()
  });

  showResult(
    "✅ Checked In!",
    `You've been marked present for ${session.courseName || "this session"}.`,
    true
  );

  loadHistory();
}

// ==========================
// LOAD ATTENDANCE HISTORY
// ==========================
async function loadHistory() {
  if (!currentStudent) return;

  try {
    const historyQuery = query(
      collection(db, "checkIns"),
      where("studentUid", "==", currentStudent.uid),
      orderBy("checkedInAt", "desc")
    );
    const snapshot = await getDocs(historyQuery);

    totalCheckInsEl.textContent = snapshot.size.toString();

    if (snapshot.empty) {
      historyList.innerHTML = `<p class="placeholder-text">No check-ins yet. Scan a session QR code to get started.</p>`;
      return;
    }

    let html = "";
    snapshot.forEach((docSnap) => {
      const checkIn = docSnap.data();
      const timeText = checkIn.checkedInAt && checkIn.checkedInAt.toDate
        ? checkIn.checkedInAt.toDate().toLocaleString()
        : "Just now";

      html += `
        <div class="history-item">
          <div class="history-item-info">
            <h4>${checkIn.courseName || "Session"}</h4>
            <p>${timeText}</p>
          </div>
          <span class="history-badge approved">✅ Present</span>
        </div>
      `;
    });

    historyList.innerHTML = html;

  } catch (error) {
    console.error("Error loading history:", error);
    historyList.innerHTML = `<p class="placeholder-text">Error: ${error.message || error}</p>`;
  }
}

// ==========================
// SIDEBAR TAB SWITCHING
// ==========================
const navItems = document.querySelectorAll(".nav-item");
const sections = document.querySelectorAll(".dashboard-section");

navItems.forEach((item) => {
  item.addEventListener("click", async (e) => {
    e.preventDefault();
    const targetSection = item.getAttribute("data-section");

    // Stop the camera if navigating away from the check-in tab
    if (targetSection !== "checkin" && html5QrCode) {
      await stopScanning();
      resetCheckinView();
    }

    navItems.forEach((nav) => nav.classList.remove("active"));
    item.classList.add("active");

    sections.forEach((section) => {
      section.classList.toggle("active", section.id === targetSection);
    });
  });
});
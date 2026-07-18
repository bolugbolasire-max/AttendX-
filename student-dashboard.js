// student-dashboard.js
import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signOut,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updateEmail,
  updatePassword,
  sendEmailVerification
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc,
  addDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { initSessionLock } from "./session-lock.js";

// Maximum allowed distance (in meters) between the student and the
// lecturer's session location for a check-in to be accepted.
// NOTE: this is enforced client-side only (see conversation notes) —
// good enough to stop casual/accidental out-of-range check-ins, but a
// technically determined student could spoof their GPS to bypass it.
// Tamper-proof enforcement would need a Cloud Function (planned, not
// yet built).
const MAX_CHECKIN_DISTANCE_METERS = 100;

// Cap on how many history rows we render at once. Firestore itself is
// still only asked for this many documents, so a lecturer/student with
// hundreds of check-ins doesn't stall the page or download a huge
// payload just to show a list.
const HISTORY_DISPLAY_LIMIT = 50;

// Where face-api.js should load its model weights from.
const FACE_MODEL_URL = "https://cdn.jsdelivr.net/gh/vladmandic/face-api/model";

const loadingScreen = document.getElementById("loadingScreen");
const dashboardContent = document.getElementById("dashboardContent");
const welcomeMessage = document.getElementById("welcomeMessage");
const schoolLine = document.getElementById("schoolLine");
const userEmail = document.getElementById("userEmail");
const logoutBtn = document.getElementById("logoutBtn");

const totalCheckInsEl = document.getElementById("totalCheckIns");

// Face verification step elements
const faceStepCard = document.getElementById("faceStepCard");
const faceCameraContainer = document.getElementById("faceCameraContainer");
const faceVideo = document.getElementById("faceVideo");
const faceCanvas = document.getElementById("faceCanvas");
const faceMessage = document.getElementById("faceMessage");
const startFaceBtn = document.getElementById("startFaceBtn");
const captureFaceBtn = document.getElementById("captureFaceBtn");
const retakeFaceBtn = document.getElementById("retakeFaceBtn");

// QR scan step elements
const scanStepCard = document.getElementById("scanStepCard");
const startScanBtn = document.getElementById("startScanBtn");
const stopScanBtn = document.getElementById("stopScanBtn");
const qrReaderContainer = document.getElementById("qrReaderContainer");
const checkinMessage = document.getElementById("checkinMessage");
const checkinResultCard = document.getElementById("checkinResultCard");
const checkinResultTitle = document.getElementById("checkinResultTitle");
const checkinResultText = document.getElementById("checkinResultText");
const scanAnotherBtn = document.getElementById("scanAnotherBtn");

const historyList = document.getElementById("historyList");

// New Overview elements
const profileAvatarSmall = document.getElementById("profileAvatarSmall");
const profileAvatarLarge = document.getElementById("profileAvatarLarge");
const overviewName = document.getElementById("overviewName");
const overviewLevelDept = document.getElementById("overviewLevelDept");
const todayStatusLine = document.getElementById("todayStatusLine");
const totalCoursesStat = document.getElementById("totalCoursesStat");
const classesMissedStat = document.getElementById("classesMissedStat");
const attendanceRateStat = document.getElementById("attendanceRateStat");

// My Courses / enrollment elements
const myCoursesList = document.getElementById("myCoursesList");
const availableCoursesList = document.getElementById("availableCoursesList");
const enrollSearchInput = document.getElementById("enrollSearchInput");
const enrollLevelFilter = document.getElementById("enrollLevelFilter");
const enrollSemesterFilter = document.getElementById("enrollSemesterFilter");
const enrollMessage = document.getElementById("enrollMessage");

// Attendance History filter elements
const historySearchInput = document.getElementById("historySearchInput");
const historyCourseFilter = document.getElementById("historyCourseFilter");
const historySemesterFilter = document.getElementById("historySemesterFilter");
const historyDateFilter = document.getElementById("historyDateFilter");
const downloadHistoryBtn = document.getElementById("downloadHistoryBtn");

// Analytics elements
const analyticsOverallRate = document.getElementById("analyticsOverallRate");
const analyticsPresentTotal = document.getElementById("analyticsPresentTotal");
const analyticsAbsentTotal = document.getElementById("analyticsAbsentTotal");
const courseAttendanceBreakdown = document.getElementById("courseAttendanceBreakdown");
const monthlyTrendContainer = document.getElementById("monthlyTrendContainer");

// Profile elements
const profileFullName = document.getElementById("profileFullName");
const profileMatric = document.getElementById("profileMatric");
const profileDeptLevel = document.getElementById("profileDeptLevel");
const profilePhoneInput = document.getElementById("profilePhoneInput");
const profilePhoneMessage = document.getElementById("profilePhoneMessage");
const savePhoneBtn = document.getElementById("savePhoneBtn");
const profileEmailInput = document.getElementById("profileEmailInput");
const profileEmailPassword = document.getElementById("profileEmailPassword");
const profileEmailMessage = document.getElementById("profileEmailMessage");
const saveEmailBtn = document.getElementById("saveEmailBtn");
const currentPasswordInput = document.getElementById("currentPasswordInput");
const newPasswordInput = document.getElementById("newPasswordInput");
const profilePasswordMessage = document.getElementById("profilePasswordMessage");
const changePasswordBtn = document.getElementById("changePasswordBtn");

// Caches used across the new sections
let myEnrollments = [];      // this student's enrollment docs (active only)
let allCheckIns = [];        // this student's full check-in history, cached for filtering
let allSchoolCourses = [];   // all courses at this student's school, for the enroll browser

let currentStudent = null; // { uid, fullName, matricNumber, schoolId, schoolName }
let html5QrCode = null;
let isProcessingScan = false; // guards against double-processing the same scan

let faceStream = null;
let faceModelsLoaded = false;
let faceModelsLoading = null; // holds the in-flight load promise, if any
let capturedFacePhoto = null; // data URL of the confirmed face photo for this check-in

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

    // Check the school's status BEFORE rendering anything. Previously
    // this was only checked via a live listener started after the
    // dashboard had already rendered and begun loading data — a student
    // whose school was suspended before they even logged in would see
    // a flash of their dashboard before being kicked out. Now it's
    // checked upfront, so a suspended student never sees the dashboard
    // at all.
    if (userData.schoolId) {
      const schoolSnap = await getDoc(doc(db, "schools", userData.schoolId));
      if (schoolSnap.exists() && schoolSnap.data().status === "suspended") {
        window.location.href = "school-suspended.html";
        return;
      }
    }

    currentStudent = {
      uid: user.uid,
      fullName: userData.fullName || "Student",
      matricNumber: userData.matricNumber || "",
      schoolId: userData.schoolId || "",
      schoolName: userData.schoolName || "",
      department: userData.department || "",
      level: userData.level || "",
      phone: userData.phone || "",
      photoUrl: userData.photoUrl || ""
    };

    welcomeMessage.textContent = `Welcome, ${userData.fullName || "Student"}`;
    schoolLine.textContent = userData.schoolName || "";
    userEmail.textContent = userData.email || user.email;

    // Populate the new Overview profile summary and Profile tab fields
    overviewName.textContent = currentStudent.fullName;
    overviewLevelDept.textContent = [currentStudent.level ? `Level ${currentStudent.level}` : "", currentStudent.department]
      .filter(Boolean).join(" · ") || "No department/level on file";

    profileFullName.textContent = currentStudent.fullName;
    profileMatric.textContent = currentStudent.matricNumber ? `Matric No: ${currentStudent.matricNumber}` : "";
    profileDeptLevel.textContent = [currentStudent.department, currentStudent.level ? `Level ${currentStudent.level}` : ""]
      .filter(Boolean).join(" · ");
    profilePhoneInput.value = currentStudent.phone;

    if (currentStudent.photoUrl) {
      profileAvatarSmall.innerHTML = `<img src="${currentStudent.photoUrl}" style="width:100%; height:100%; object-fit:cover;">`;
      profileAvatarLarge.innerHTML = `<img src="${currentStudent.photoUrl}" style="width:100%; height:100%; object-fit:cover;">`;
    }

    loadingScreen.style.display = "none";
    dashboardContent.style.display = "flex";

    // Start the inactivity lock/logout system for this session.
    initSessionLock({
      uid: user.uid,
      email: userData.email || user.email,
      role: userData.role,
      loginPage: "student-login.html"
    });

    loadHistory();
    loadMyCourses();
    loadAvailableCourses();

    // Start loading face-api.js models in the background as soon as the
    // dashboard is up, so they're likely ready by the time the student
    // taps "Verify My Face" — avoids a cold-start wait on that tap.
    loadFaceModels();

    // Live-watch this student's school for suspension. If a Super Admin
    // suspends the school while the student is actively using the
    // dashboard, this kicks them out immediately rather than waiting
    // for their next login.
    if (currentStudent.schoolId) {
      onSnapshot(doc(db, "schools", currentStudent.schoolId), (schoolSnap) => {
        if (schoolSnap.exists() && schoolSnap.data().status === "suspended") {
          signOut(auth).then(() => {
            window.location.href = "school-suspended.html";
          });
        }
      });
    }

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
    stopFaceCamera();
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
// FACE VERIFICATION (step 1 of check-in)
// ==========================
// Loads the tiny face detector model from face-api.js. Cheap (~190KB),
// runs entirely client-side — no external API calls, no cost.
function loadFaceModels() {
  if (faceModelsLoaded) return Promise.resolve();
  if (faceModelsLoading) return faceModelsLoading;

  faceModelsLoading = faceapi.nets.tinyFaceDetector
    .loadFromUri(FACE_MODEL_URL)
    .then(() => {
      faceModelsLoaded = true;
    })
    .catch((error) => {
      console.error("Error loading face detection models:", error);
      faceModelsLoading = null; // allow a retry later
      throw error;
    });

  return faceModelsLoading;
}

function showFaceMessage(text, type) {
  faceMessage.textContent = text;
  faceMessage.className = `form-message ${type}`;
}

async function startFaceCamera() {
  try {
    faceStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" }
    });
    faceVideo.srcObject = faceStream;
    faceCameraContainer.style.display = "block";
  } catch (error) {
    console.error("Error accessing camera:", error);
    throw new Error("Could not access your camera. Please allow camera permission and try again.");
  }
}

function stopFaceCamera() {
  if (faceStream) {
    faceStream.getTracks().forEach((track) => track.stop());
    faceStream = null;
  }
  faceCameraContainer.style.display = "none";
}

startFaceBtn.addEventListener("click", async () => {
  showFaceMessage("", "");
  startFaceBtn.disabled = true;
  startFaceBtn.textContent = "Starting camera...";

  try {
    // Models usually finish loading well before a student reaches this
    // screen (kicked off right after login), but wait here just in case.
    await loadFaceModels();
    await startFaceCamera();

    startFaceBtn.style.display = "none";
    captureFaceBtn.style.display = "block";
    showFaceMessage("Center your face in frame, then tap Capture.", "");

  } catch (error) {
    showFaceMessage(error.message || "Could not start face verification.", "error");
    startFaceBtn.disabled = false;
    startFaceBtn.textContent = "😊 Verify My Face";
  }
});

captureFaceBtn.addEventListener("click", async () => {
  captureFaceBtn.disabled = true;
  captureFaceBtn.textContent = "Checking...";
  showFaceMessage("Checking for a face...", "");

  try {
    // Draw the current video frame to a canvas so we can both run
    // detection on it and keep a still photo if it passes.
    const width = faceVideo.videoWidth || 320;
    const height = faceVideo.videoHeight || 240;
    faceCanvas.width = width;
    faceCanvas.height = height;
    const ctx = faceCanvas.getContext("2d");
    ctx.drawImage(faceVideo, 0, 0, width, height);

    const detection = await faceapi.detectSingleFace(
      faceCanvas,
      new faceapi.TinyFaceDetectorOptions()
    );

    if (!detection) {
      showFaceMessage("No face detected. Make sure your face is well-lit and centered, then try again.", "error");
      captureFaceBtn.disabled = false;
      captureFaceBtn.textContent = "📸 Capture";
      return;
    }

    // Face confirmed — keep a compressed still photo with the check-in
    // record and move to the QR scan step. This is presence confirmation
    // only (not identity matching), so lecturers can spot-check manually
    // if something looks off.
    capturedFacePhoto = faceCanvas.toDataURL("image/jpeg", 0.6);

    stopFaceCamera();
    faceStepCard.style.display = "none";
    scanStepCard.style.display = "block";

  } catch (error) {
    console.error("Face detection error:", error);
    showFaceMessage("Something went wrong checking for a face. Please try again.", "error");
    captureFaceBtn.disabled = false;
    captureFaceBtn.textContent = "📸 Capture";
  }
});

retakeFaceBtn.addEventListener("click", () => {
  capturedFacePhoto = null;
  showFaceMessage("", "");
  captureFaceBtn.disabled = false;
  captureFaceBtn.textContent = "📸 Capture";
});

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
  scanStepCard.style.display = "none";

  // Reset back to the face verification step for the next check-in
  faceStepCard.style.display = "block";
  capturedFacePhoto = null;
  startFaceBtn.style.display = "block";
  startFaceBtn.disabled = false;
  startFaceBtn.textContent = "😊 Verify My Face";
  captureFaceBtn.style.display = "none";
  captureFaceBtn.disabled = false;
  captureFaceBtn.textContent = "📸 Capture";
  showFaceMessage("", "");

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

  // 4. Write the check-in (includes the face-verification photo captured
  // in step 1, if the browser supported camera access)
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
    facePhoto: capturedFacePhoto || null,
    checkedInAt: serverTimestamp()
  });

  // Notify the student their attendance was recorded. Failure here
  // should never block the check-in itself from succeeding, so this is
  // wrapped separately and only logged if it fails.
  try {
    await addDoc(collection(db, "notifications"), {
      studentUid: currentStudent.uid,
      type: "attendance-marked",
      title: "Attendance marked",
      body: `You were marked present for ${session.courseName || "a session"}.`,
      courseName: session.courseName || "",
      read: false,
      createdAt: serverTimestamp(),
      readAt: null
    });
  } catch (notifError) {
    console.error("Failed to create attendance notification:", notifError);
  }

  showResult(
    "✅ Checked In!",
    `You've been marked present for ${session.courseName || "this session"}.`,
    true
  );

  loadHistory();
}

// ==========================
// MY COURSES (enrolled)
// ==========================
async function loadMyCourses() {
  if (!currentStudent) return;

  myCoursesList.innerHTML = `<p class="placeholder-text">Loading your courses...</p>`;

  try {
    const enrollQuery = query(
      collection(db, "enrollments"),
      where("studentUid", "==", currentStudent.uid),
      where("status", "==", "active")
    );
    const snapshot = await getDocs(enrollQuery);

    myEnrollments = [];
    snapshot.forEach((docSnap) => {
      myEnrollments.push({ id: docSnap.id, ...docSnap.data() });
    });

    totalCoursesStat.textContent = myEnrollments.length.toString();

    // Populate the course filter dropdown on the History tab too, now
    // that we know which courses this student is actually enrolled in.
    historyCourseFilter.innerHTML = `<option value="">All courses</option>` +
      myEnrollments.map((e) => `<option value="${escapeHtmlStu(e.courseName)}">${escapeHtmlStu(e.courseName)}</option>`).join("");

    if (myEnrollments.length === 0) {
      myCoursesList.innerHTML = `<p class="placeholder-text">You're not enrolled in any courses yet. Browse available courses below to get started.</p>`;
      return;
    }

    let html = "";
    myEnrollments.forEach((enr) => {
      html += `
        <div class="history-item">
          <div class="history-item-info">
            <h4>${escapeHtmlStu(enr.courseName)}</h4>
            <p>${escapeHtmlStu(enr.courseCode || "")} ${enr.department ? "· " + escapeHtmlStu(enr.department) : ""} ${enr.level ? "· Level " + escapeHtmlStu(enr.level) : ""} ${enr.semester ? "· " + escapeHtmlStu(enr.semester) + " Semester" : ""}</p>
          </div>
        </div>
      `;
    });

    myCoursesList.innerHTML = html;

    // Recompute analytics/attendance-rate stats now that enrollment
    // count is known — these depend on both enrollments and check-ins.
    updateAttendanceStats();

  } catch (error) {
    console.error("Error loading my courses:", error);
    myCoursesList.innerHTML = `<p class="placeholder-text">Couldn't load your courses right now — check your connection and try refreshing.</p>`;
  }
}

// ==========================
// BROWSE & SELF-ENROLL
// ==========================
async function loadAvailableCourses() {
  if (!currentStudent || !currentStudent.schoolId) return;

  availableCoursesList.innerHTML = `<p class="placeholder-text">Loading available courses...</p>`;

  try {
    const coursesQuery = query(
      collection(db, "courses"),
      where("schoolId", "==", currentStudent.schoolId)
    );
    const snapshot = await getDocs(coursesQuery);

    allSchoolCourses = [];
    snapshot.forEach((docSnap) => {
      const course = { id: docSnap.id, ...docSnap.data() };
      if (!course.archived) allSchoolCourses.push(course);
    });

    const levels = [...new Set(allSchoolCourses.map((c) => c.level).filter(Boolean))].sort();
    enrollLevelFilter.innerHTML = `<option value="">All levels</option>` +
      levels.map((lvl) => `<option value="${escapeHtmlStu(lvl)}">${escapeHtmlStu(lvl)}</option>`).join("");

    renderAvailableCourses();

  } catch (error) {
    console.error("Error loading available courses:", error);
    availableCoursesList.innerHTML = `<p class="placeholder-text">Couldn't load available courses right now — check your connection and try refreshing.</p>`;
  }
}

function renderAvailableCourses() {
  const searchTerm = (enrollSearchInput.value || "").trim().toLowerCase();
  const levelFilterVal = enrollLevelFilter.value;
  const semesterFilterVal = enrollSemesterFilter.value;

  const enrolledCourseIds = new Set(myEnrollments.map((e) => e.courseId));

  const filtered = allSchoolCourses.filter((course) => {
    if (levelFilterVal && course.level !== levelFilterVal) return false;
    if (semesterFilterVal && course.semester !== semesterFilterVal) return false;

    if (searchTerm) {
      const haystack = [course.courseName, course.courseCode, course.department]
        .filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(searchTerm)) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    availableCoursesList.innerHTML = `<p class="placeholder-text">${allSchoolCourses.length === 0 ? "No courses available at your school yet." : "No courses match your search/filter."}</p>`;
    return;
  }

  let html = "";
  filtered.forEach((course) => {
    const isEnrolled = enrolledCourseIds.has(course.id);
    html += `
      <div class="history-item">
        <div class="history-item-info">
          <h4>${escapeHtmlStu(course.courseName)}</h4>
          <p>${escapeHtmlStu(course.courseCode || "")} ${course.department ? "· " + escapeHtmlStu(course.department) : ""} ${course.level ? "· Level " + escapeHtmlStu(course.level) : ""} ${course.semester ? "· " + escapeHtmlStu(course.semester) + " Semester" : ""}</p>
        </div>
        ${isEnrolled
          ? `<span class="history-badge approved">✅ Enrolled</span>`
          : `<button type="button" class="enroll-course-btn" data-id="${course.id}">Enroll</button>`
        }
      </div>
    `;
  });

  availableCoursesList.innerHTML = html;

  document.querySelectorAll(".enroll-course-btn").forEach((btn) => {
    btn.addEventListener("click", () => enrollInCourse(btn.getAttribute("data-id"), btn));
  });
}

enrollSearchInput.addEventListener("input", renderAvailableCourses);
enrollLevelFilter.addEventListener("change", renderAvailableCourses);
enrollSemesterFilter.addEventListener("change", renderAvailableCourses);

async function enrollInCourse(courseId, btnEl) {
  const course = allSchoolCourses.find((c) => c.id === courseId);
  if (!course || !currentStudent) return;

  btnEl.disabled = true;
  btnEl.textContent = "Enrolling...";
  enrollMessage.textContent = "";

  try {
    await addDoc(collection(db, "enrollments"), {
      studentUid: currentStudent.uid,
      studentName: currentStudent.fullName,
      matricNumber: currentStudent.matricNumber,
      courseId: course.id,
      courseName: course.courseName,
      courseCode: course.courseCode || "",
      schoolId: currentStudent.schoolId,
      department: course.department || "",
      level: course.level || "",
      semester: course.semester || "",
      status: "active",
      enrolledAt: serverTimestamp()
    });

    enrollMessage.textContent = `Enrolled in ${course.courseName} successfully.`;
    enrollMessage.className = "form-message success";

    await loadMyCourses();
    renderAvailableCourses();

  } catch (error) {
    console.error("Error enrolling in course:", error);
    enrollMessage.textContent = "Couldn't enroll right now. Please try again.";
    enrollMessage.className = "form-message error";
    btnEl.disabled = false;
    btnEl.textContent = "Enroll";
  }
}

function escapeHtmlStu(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


async function loadHistory() {
  if (!currentStudent) return;

  historyList.innerHTML = `<p class="placeholder-text">Loading history...</p>`;

  try {
    const historyQuery = query(
      collection(db, "checkIns"),
      where("studentUid", "==", currentStudent.uid),
      orderBy("checkedInAt", "desc"),
      limit(HISTORY_DISPLAY_LIMIT)
    );
    const snapshot = await getDocs(historyQuery);

    allCheckIns = [];
    snapshot.forEach((docSnap) => {
      allCheckIns.push({ id: docSnap.id, ...docSnap.data() });
    });

    totalCheckInsEl.textContent = allCheckIns.length >= HISTORY_DISPLAY_LIMIT
      ? `${allCheckIns.length}+`
      : allCheckIns.length.toString();

    // Today's attendance status: did this student check in to anything today?
    const todayStr = new Date().toDateString();
    const checkedInToday = allCheckIns.some((c) => {
      const d = c.checkedInAt && c.checkedInAt.toDate ? c.checkedInAt.toDate() : null;
      return d && d.toDateString() === todayStr;
    });
    todayStatusLine.textContent = checkedInToday
      ? "✅ Checked in today"
      : "⚪ No check-in recorded today";
    todayStatusLine.style.color = checkedInToday ? "var(--secondary)" : "var(--text-light)";

    renderHistoryList();
    updateAttendanceStats();

  } catch (error) {
    console.error("Error loading history:", error);
    historyList.innerHTML = `<p class="placeholder-text">Couldn't load your history right now — check your connection and try reopening this tab.</p>`;
  }
}

// Renders allCheckIns into the history list, applying search/course/
// semester/date filters. Called on load and on every filter change.
function renderHistoryList() {
  const searchTerm = (historySearchInput.value || "").trim().toLowerCase();
  const courseFilterVal = historyCourseFilter.value;
  const semesterFilterVal = historySemesterFilter.value;
  const dateFilterVal = historyDateFilter.value; // "YYYY-MM-DD" or ""

  // Build a quick lookup from courseName -> semester, via enrollments,
  // since checkIns themselves don't store semester.
  const semesterByCourse = {};
  myEnrollments.forEach((e) => { semesterByCourse[e.courseName] = e.semester; });

  const filtered = allCheckIns.filter((c) => {
    if (courseFilterVal && c.courseName !== courseFilterVal) return false;

    if (semesterFilterVal && semesterByCourse[c.courseName] !== semesterFilterVal) return false;

    if (searchTerm && !(c.courseName || "").toLowerCase().includes(searchTerm)) return false;

    if (dateFilterVal) {
      const d = c.checkedInAt && c.checkedInAt.toDate ? c.checkedInAt.toDate() : null;
      if (!d) return false;
      const dStr = d.toISOString().slice(0, 10);
      if (dStr !== dateFilterVal) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    historyList.innerHTML = `<p class="placeholder-text">${allCheckIns.length === 0 ? "No check-ins yet. Scan a session QR code to get started." : "No check-ins match your search/filter."}</p>`;
    return;
  }

  let html = "";
  filtered.forEach((checkIn) => {
    const timeText = checkIn.checkedInAt && checkIn.checkedInAt.toDate
      ? checkIn.checkedInAt.toDate().toLocaleString()
      : "Just now";

    html += `
      <div class="history-item">
        <div class="history-item-info">
          <h4>${escapeHtmlStu(checkIn.courseName || "Session")}</h4>
          <p>${timeText}</p>
        </div>
        <span class="history-badge approved">✅ Present</span>
      </div>
    `;
  });

  if (allCheckIns.length >= HISTORY_DISPLAY_LIMIT) {
    html += `<p class="placeholder-text">Showing your ${HISTORY_DISPLAY_LIMIT} most recent check-ins.</p>`;
  }

  historyList.innerHTML = html;
}

historySearchInput.addEventListener("input", renderHistoryList);
historyCourseFilter.addEventListener("change", renderHistoryList);
historySemesterFilter.addEventListener("change", renderHistoryList);
historyDateFilter.addEventListener("change", renderHistoryList);

// ==========================
// DOWNLOAD ATTENDANCE HISTORY (CSV)
// ==========================
downloadHistoryBtn.addEventListener("click", () => {
  let csvContent = "Course,Check-in Time\n";

  allCheckIns.forEach((c) => {
    const timeText = c.checkedInAt && c.checkedInAt.toDate
      ? c.checkedInAt.toDate().toLocaleString()
      : "";
    csvContent += `"${(c.courseName || "").replace(/"/g, '""')}","${timeText}"\n`;
  });

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${(currentStudent.matricNumber || "student")}-attendance-history.csv`.replace(/\s+/g, "_");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
});

// ==========================
// ATTENDANCE STATS (Overview stat cards + Analytics section)
// ==========================
// Since a course's expected session count varies, "classes missed" and
// "attendance rate" here are computed per-course: for each course this
// student is enrolled in, we compare their check-ins against the total
// number of sessions that have been held for that course (by any
// lecturer, at this school) — a real denominator, not a guess.
async function updateAttendanceStats() {
  if (!currentStudent || myEnrollments.length === 0) {
    classesMissedStat.textContent = "0";
    attendanceRateStat.textContent = "0%";
    return;
  }

  try {
    let totalExpected = 0;
    let totalPresent = 0;
    const perCourseBreakdown = [];

    for (const enr of myEnrollments) {
      const sessionsQuery = query(
        collection(db, "sessions"),
        where("schoolId", "==", currentStudent.schoolId),
        where("courseName", "==", enr.courseName)
      );
      const sessionsSnap = await getDocs(sessionsQuery);
      const sessionsHeld = sessionsSnap.size;

      const presentCount = allCheckIns.filter((c) => c.courseName === enr.courseName).length;

      totalExpected += sessionsHeld;
      totalPresent += presentCount;

      perCourseBreakdown.push({
        courseName: enr.courseName,
        sessionsHeld,
        presentCount,
        rate: sessionsHeld > 0 ? Math.round((presentCount / sessionsHeld) * 100) : null
      });
    }

    const missed = Math.max(totalExpected - totalPresent, 0);
    const rate = totalExpected > 0 ? Math.round((totalPresent / totalExpected) * 100) : 0;

    classesMissedStat.textContent = missed.toString();
    attendanceRateStat.textContent = `${rate}%`;
    analyticsOverallRate.textContent = `${rate}%`;
    analyticsPresentTotal.textContent = totalPresent.toString();
    analyticsAbsentTotal.textContent = missed.toString();

    renderCourseAttendanceBreakdown(perCourseBreakdown);
    renderMonthlyTrend();

  } catch (error) {
    console.error("Error computing attendance stats:", error);
  }
}

function renderCourseAttendanceBreakdown(breakdown) {
  if (breakdown.length === 0) {
    courseAttendanceBreakdown.innerHTML = `<p class="placeholder-text">Enroll in a course to see your attendance breakdown.</p>`;
    return;
  }

  let html = "";
  breakdown.forEach((b) => {
    const rateText = b.rate === null ? "No sessions held yet" : `${b.rate}% (${b.presentCount}/${b.sessionsHeld})`;
    html += `
      <div class="history-item">
        <div class="history-item-info">
          <h4>${escapeHtmlStu(b.courseName)}</h4>
          <p>${rateText}</p>
        </div>
      </div>
    `;
  });

  courseAttendanceBreakdown.innerHTML = html;
}

// Groups this student's check-ins by calendar month, most recent 6
// months, and renders a simple bar list.
function renderMonthlyTrend() {
  if (allCheckIns.length === 0) {
    monthlyTrendContainer.innerHTML = `<p class="placeholder-text">No check-in data yet to show a trend.</p>`;
    return;
  }

  const byMonth = {};
  allCheckIns.forEach((c) => {
    const d = c.checkedInAt && c.checkedInAt.toDate ? c.checkedInAt.toDate() : null;
    if (!d) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    byMonth[key] = (byMonth[key] || 0) + 1;
  });

  const sortedKeys = Object.keys(byMonth).sort().slice(-6);

  if (sortedKeys.length === 0) {
    monthlyTrendContainer.innerHTML = `<p class="placeholder-text">No check-in data yet to show a trend.</p>`;
    return;
  }

  const maxCount = Math.max(...sortedKeys.map((k) => byMonth[k]), 1);

  let html = `<div style="display:flex; align-items:flex-end; gap:14px; height:140px; padding:10px 0;">`;
  sortedKeys.forEach((key) => {
    const [year, month] = key.split("-");
    const label = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(undefined, { month: "short" });
    const count = byMonth[key];
    const heightPct = Math.max((count / maxCount) * 100, 4);
    html += `
      <div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:4px;">
        <span style="font-size:0.75rem; color:var(--text-light);">${count}</span>
        <div style="width:100%; max-width:36px; height:${heightPct}%; background:var(--primary); border-radius:4px 4px 0 0;"></div>
        <span style="font-size:0.75rem; color:var(--text-light);">${label}</span>
      </div>
    `;
  });
  html += `</div>`;

  monthlyTrendContainer.innerHTML = html;
}

// ==========================
// PROFILE — UPDATE PHONE NUMBER
// ==========================
savePhoneBtn.addEventListener("click", async () => {
  const phone = profilePhoneInput.value.trim();

  savePhoneBtn.disabled = true;
  savePhoneBtn.textContent = "Saving...";
  profilePhoneMessage.textContent = "";

  try {
    await updateDoc(doc(db, "users", currentStudent.uid), { phone });
    currentStudent.phone = phone;
    profilePhoneMessage.textContent = "Phone number updated.";
    profilePhoneMessage.className = "form-message success";
  } catch (error) {
    console.error("Error updating phone:", error);
    profilePhoneMessage.textContent = "Couldn't save your phone number. Please try again.";
    profilePhoneMessage.className = "form-message error";
  }

  savePhoneBtn.disabled = false;
  savePhoneBtn.textContent = "Save Phone Number";
});

// ==========================
// PROFILE — UPDATE EMAIL
// ==========================
// Firebase requires a recent sign-in to change email/password, so we
// re-authenticate with the current password first. After a successful
// email change, Firebase sends a verification email to the new address
// automatically in recent SDK versions; we also explicitly trigger one
// here for certainty, matching the verification-gated login flow this
// app already uses for students.
saveEmailBtn.addEventListener("click", async () => {
  const newEmail = profileEmailInput.value.trim();
  const currentPassword = profileEmailPassword.value;

  if (!newEmail || !currentPassword) {
    profileEmailMessage.textContent = "Please enter both a new email and your current password.";
    profileEmailMessage.className = "form-message error";
    return;
  }

  saveEmailBtn.disabled = true;
  saveEmailBtn.textContent = "Updating...";
  profileEmailMessage.textContent = "";

  try {
    const user = auth.currentUser;
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);

    await updateEmail(user, newEmail);
    await updateDoc(doc(db, "users", currentStudent.uid), { email: newEmail });
    await sendEmailVerification(user);

    profileEmailMessage.textContent = "Email updated. Please check your new inbox to verify it.";
    profileEmailMessage.className = "form-message success";
    profileEmailInput.value = "";
    profileEmailPassword.value = "";
    userEmail.textContent = newEmail;

  } catch (error) {
    console.error("Error updating email:", error);
    if (error.code === "auth/wrong-password" || error.code === "auth/invalid-credential") {
      profileEmailMessage.textContent = "Incorrect current password.";
    } else if (error.code === "auth/email-already-in-use") {
      profileEmailMessage.textContent = "That email is already in use by another account.";
    } else if (error.code === "auth/invalid-email") {
      profileEmailMessage.textContent = "Please enter a valid email address.";
    } else {
      profileEmailMessage.textContent = "Couldn't update your email right now. Please try again.";
    }
    profileEmailMessage.className = "form-message error";
  }

  saveEmailBtn.disabled = false;
  saveEmailBtn.textContent = "Update Email";
});

// ==========================
// PROFILE — CHANGE PASSWORD
// ==========================
changePasswordBtn.addEventListener("click", async () => {
  const currentPassword = currentPasswordInput.value;
  const newPassword = newPasswordInput.value;

  if (!currentPassword || !newPassword) {
    profilePasswordMessage.textContent = "Please fill in both password fields.";
    profilePasswordMessage.className = "form-message error";
    return;
  }

  if (newPassword.length < 6) {
    profilePasswordMessage.textContent = "New password must be at least 6 characters.";
    profilePasswordMessage.className = "form-message error";
    return;
  }

  changePasswordBtn.disabled = true;
  changePasswordBtn.textContent = "Updating...";
  profilePasswordMessage.textContent = "";

  try {
    const user = auth.currentUser;
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);

    await updatePassword(user, newPassword);

    profilePasswordMessage.textContent = "Password changed successfully.";
    profilePasswordMessage.className = "form-message success";
    currentPasswordInput.value = "";
    newPasswordInput.value = "";

  } catch (error) {
    console.error("Error changing password:", error);
    if (error.code === "auth/wrong-password" || error.code === "auth/invalid-credential") {
      profilePasswordMessage.textContent = "Incorrect current password.";
    } else if (error.code === "auth/weak-password") {
      profilePasswordMessage.textContent = "Please choose a stronger password.";
    } else {
      profilePasswordMessage.textContent = "Couldn't change your password right now. Please try again.";
    }
    profilePasswordMessage.className = "form-message error";
  }

  changePasswordBtn.disabled = false;
  changePasswordBtn.textContent = "Change Password";
});

// ==========================
// SIDEBAR TAB SWITCHING
// ==========================
const navItems = document.querySelectorAll(".nav-item");
const sections = document.querySelectorAll(".dashboard-section");

navItems.forEach((item) => {
  item.addEventListener("click", async (e) => {
    e.preventDefault();
    const targetSection = item.getAttribute("data-section");

    // Stop any active camera if navigating away from the check-in tab
    if (targetSection !== "checkin") {
      if (html5QrCode) {
        await stopScanning();
      }
      stopFaceCamera();
      resetCheckinView();
    }

    navItems.forEach((nav) => nav.classList.remove("active"));
    item.classList.add("active");

    sections.forEach((section) => {
      section.classList.toggle("active", section.id === targetSection);
    });
  });
});
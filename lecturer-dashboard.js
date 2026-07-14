// lecturer-dashboard.js
import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const loadingScreen = document.getElementById("loadingScreen");
const dashboardContent = document.getElementById("dashboardContent");
const welcomeMessage = document.getElementById("welcomeMessage");
const departmentLine = document.getElementById("departmentLine");
const userEmail = document.getElementById("userEmail");
const logoutBtn = document.getElementById("logoutBtn");

// Session elements
const courseSelect = document.getElementById("courseSelect");
const otherCourseGroup = document.getElementById("otherCourseGroup");
const otherCourseInput = document.getElementById("otherCourseInput");
const startSessionBtn = document.getElementById("startSessionBtn");
const endSessionBtn = document.getElementById("endSessionBtn");
const sessionFormCard = document.getElementById("sessionFormCard");
const activeSessionCard = document.getElementById("activeSessionCard");
const sessionFormMessage = document.getElementById("sessionFormMessage");
const activeCourseText = document.getElementById("activeCourseText");
const sessionIdText = document.getElementById("sessionIdText");
const qrCodeContainer = document.getElementById("qrCodeContainer");
const sessionHistoryList = document.getElementById("sessionHistoryList");

// Overview stat elements
const courseCountEl = document.getElementById("courseCount");
const sessionCountEl = document.getElementById("sessionCount");
const totalAttendanceEl = document.getElementById("totalAttendance");

// Course management elements
const courseListDisplay = document.getElementById("courseListDisplay");
const requestCourseName = document.getElementById("requestCourseName");
const requestCourseCode = document.getElementById("requestCourseCode");
const courseRequestMessage = document.getElementById("courseRequestMessage");
const submitCourseRequestBtn = document.getElementById("submitCourseRequestBtn");
const courseRequestList = document.getElementById("courseRequestList");

// Reports elements
const reportSessionSelect = document.getElementById("reportSessionSelect");
const reportMessage = document.getElementById("reportMessage");
const exportCsvBtn = document.getElementById("exportCsvBtn");
const attendeeTableContainer = document.getElementById("attendeeTableContainer");

let lecturerSessions = []; // cache of this lecturer's sessions, used by the Reports dropdown

let currentLecturer = null; // filled in once auth guard confirms lecturer
let currentSessionId = null; // Firestore doc id of the active session

// ==========================
// AUTH GUARD
// ==========================
// This runs every time the page loads. If there's no logged-in user,
// or the logged-in user isn't a lecturer, we kick them back to login.
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // Not logged in at all
    window.location.href = "lecturer-login.html";
    return;
  }

  try {
    const userDocRef = doc(db, "users", user.uid);
    const userDocSnap = await getDoc(userDocRef);

    if (!userDocSnap.exists() || userDocSnap.data().role !== "lecturer") {
      // Logged in, but not as a lecturer — not authorized for this page
      window.location.href = "lecturer-login.html";
      return;
    }

    const userData = userDocSnap.data();

    // Populate the dashboard with this lecturer's real data from Firestore
    welcomeMessage.textContent = `Welcome, ${userData.fullName || "Lecturer"}`;
    departmentLine.textContent = userData.department || "";
    userEmail.textContent = userData.email || user.email;

    if (!userData.schoolId) {
      // Lecturer accounts should always be created by a School Admin, which
      // stamps schoolId onto the profile. If it's missing, something's off.
      welcomeMessage.textContent = "No school assigned to this account. Contact your school admin.";
      loadingScreen.style.display = "none";
      dashboardContent.style.display = "flex";
      return;
    }

    // Save lecturer info for use in session creation later
    currentLecturer = {
      uid: user.uid,
      fullName: userData.fullName || "Lecturer",
      department: userData.department || "",
      schoolId: userData.schoolId,
      schoolName: userData.schoolName || ""
    };

    // Reveal the dashboard, hide the loading screen
    loadingScreen.style.display = "none";
    dashboardContent.style.display = "flex";

    // Load courses for the session dropdown
    loadCourses();

    // Load this lecturer's session history and overview stats
    loadSessionHistory();

    // Load the course list display and this lecturer's past requests
    loadCourseListDisplay();
    loadMyCourseRequests();

    // Load sessions into the Reports dropdown
    loadReportSessionOptions();

  } catch (error) {
    console.error("Error loading dashboard:", error);
    window.location.href = "lecturer-login.html";
  }
});

// ==========================
// LOGOUT
// ==========================
logoutBtn.addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.href = "lecturer-login.html";
  } catch (error) {
    console.error("Error signing out:", error);
  }
});

// ==========================
// LOAD SESSIONS INTO REPORTS DROPDOWN
// ==========================
async function loadReportSessionOptions() {
  if (!currentLecturer) return;

  try {
    const sessionsQuery = query(
      collection(db, "sessions"),
      where("lecturerUid", "==", currentLecturer.uid),
      orderBy("createdAt", "desc")
    );

    const snapshot = await getDocs(sessionsQuery);

    if (snapshot.empty) {
      reportSessionSelect.innerHTML = `<option value="">No sessions yet</option>`;
      lecturerSessions = [];
      return;
    }

    lecturerSessions = [];
    reportSessionSelect.innerHTML = `<option value="">Choose a session...</option>`;

    snapshot.forEach((docSnap) => {
      const session = docSnap.data();
      lecturerSessions.push({ id: docSnap.id, ...session });

      const dateText = session.createdAt && session.createdAt.toDate
        ? session.createdAt.toDate().toLocaleDateString()
        : "";

      const option = document.createElement("option");
      option.value = docSnap.id;
      option.textContent = `${session.courseName} — ${dateText}`;
      reportSessionSelect.appendChild(option);
    });

  } catch (error) {
    console.error("Error loading report sessions:", error);
    reportSessionSelect.innerHTML = `<option value="">Error loading sessions</option>`;
  }
}

// ==========================
// SHOW ATTENDEES WHEN A SESSION IS SELECTED
// ==========================
reportSessionSelect.addEventListener("change", async () => {
  const sessionId = reportSessionSelect.value;

  if (!sessionId) {
    attendeeTableContainer.innerHTML = `<p class="placeholder-text">Select a session above to view attendees.</p>`;
    return;
  }

  attendeeTableContainer.innerHTML = `<p class="placeholder-text">Loading attendees...</p>`;

  try {
    // Attendance check-ins will live in a "checkIns" collection once student
    // scanning is built. For now this will simply come back empty.
    const checkInsQuery = query(
      collection(db, "checkIns"),
      where("sessionId", "==", sessionId)
    );

    const snapshot = await getDocs(checkInsQuery);

    if (snapshot.empty) {
      attendeeTableContainer.innerHTML = `<p class="placeholder-text">No check-ins recorded for this session yet.</p>`;
      return;
    }

    let tableHTML = `
      <table class="attendee-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Matric Number</th>
            <th>Check-in Time</th>
          </tr>
        </thead>
        <tbody>
    `;

    snapshot.forEach((docSnap) => {
      const checkIn = docSnap.data();
      const timeText = checkIn.checkedInAt && checkIn.checkedInAt.toDate
        ? checkIn.checkedInAt.toDate().toLocaleString()
        : "";

      tableHTML += `
        <tr>
          <td>${checkIn.studentName || ""}</td>
          <td>${checkIn.matricNumber || ""}</td>
          <td>${timeText}</td>
        </tr>
      `;
    });

    tableHTML += `</tbody></table>`;
    attendeeTableContainer.innerHTML = tableHTML;

  } catch (error) {
    console.error("Error loading attendees:", error);
    attendeeTableContainer.innerHTML = `<p class="placeholder-text">Error: ${error.message || error}</p>`;
  }
});

// ==========================
// EXPORT ATTENDANCE AS CSV
// ==========================
exportCsvBtn.addEventListener("click", async () => {
  const sessionId = reportSessionSelect.value;

  if (!sessionId) {
    reportMessage.textContent = "Please select a session first.";
    reportMessage.className = "form-message error";
    return;
  }

  const session = lecturerSessions.find((s) => s.id === sessionId);

  try {
    const checkInsQuery = query(
      collection(db, "checkIns"),
      where("sessionId", "==", sessionId)
    );
    const snapshot = await getDocs(checkInsQuery);

    // Build CSV content, starting with a header row
    let csvContent = "Name,Matric Number,Check-in Time\n";

    if (!snapshot.empty) {
      snapshot.forEach((docSnap) => {
        const checkIn = docSnap.data();
        const timeText = checkIn.checkedInAt && checkIn.checkedInAt.toDate
          ? checkIn.checkedInAt.toDate().toLocaleString()
          : "";

        // Wrap each field in quotes in case names contain commas
        csvContent += `"${checkIn.studentName || ""}","${checkIn.matricNumber || ""}","${timeText}"\n`;
      });
    }

    // Trigger a file download in the browser
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const fileName = session ? `${session.courseName}-attendance.csv` : "attendance.csv";
    link.download = fileName.replace(/\s+/g, "_");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    reportMessage.textContent = "CSV downloaded successfully.";
    reportMessage.className = "form-message success";

  } catch (error) {
    console.error("Error exporting CSV:", error);
    reportMessage.textContent = `Error: ${error.message || error}`;
    reportMessage.className = "form-message error";
  }
});

// ==========================
// DISPLAY COURSE LIST (My Courses tab)
// ==========================
async function loadCourseListDisplay() {
  if (!currentLecturer) return;
  try {
    const coursesQuery = query(
      collection(db, "courses"),
      where("schoolId", "==", currentLecturer.schoolId)
    );
    const coursesSnapshot = await getDocs(coursesQuery);

    if (coursesSnapshot.empty) {
      courseListDisplay.innerHTML = `<p class="placeholder-text">No courses available yet.</p>`;
      return;
    }

    let html = "";
    coursesSnapshot.forEach((docSnap) => {
      const course = docSnap.data();
      html += `
        <div class="history-item">
          <div class="history-item-info">
            <h4>${course.courseName}</h4>
            <p>${course.courseCode || ""} ${course.department ? "· " + course.department : ""}</p>
          </div>
        </div>
      `;
    });

    courseListDisplay.innerHTML = html;

  } catch (error) {
    console.error("Error loading course list:", error);
    courseListDisplay.innerHTML = `<p class="placeholder-text">Error: ${error.message || error}</p>`;
  }
}

// ==========================
// SUBMIT A NEW COURSE REQUEST
// ==========================
submitCourseRequestBtn.addEventListener("click", async () => {
  const courseName = requestCourseName.value.trim();
  const courseCode = requestCourseCode.value.trim();

  if (!courseName) {
    courseRequestMessage.textContent = "Please enter a course name.";
    courseRequestMessage.className = "form-message error";
    return;
  }

  if (!currentLecturer) {
    courseRequestMessage.textContent = "Lecturer info not loaded yet. Please wait a moment.";
    courseRequestMessage.className = "form-message error";
    return;
  }

  submitCourseRequestBtn.disabled = true;
  submitCourseRequestBtn.textContent = "Submitting...";

  try {
    await addDoc(collection(db, "courseRequests"), {
      courseName,
      courseCode,
      department: currentLecturer.department,
      schoolId: currentLecturer.schoolId,
      requestedBy: currentLecturer.uid,
      requestedByName: currentLecturer.fullName,
      status: "pending",
      createdAt: serverTimestamp()
    });

    courseRequestMessage.textContent = "Request submitted! Your admin will review it.";
    courseRequestMessage.className = "form-message success";

    requestCourseName.value = "";
    requestCourseCode.value = "";

    loadMyCourseRequests();

  } catch (error) {
    console.error("Error submitting course request:", error);
    courseRequestMessage.textContent = `Error: ${error.message || error}`;
    courseRequestMessage.className = "form-message error";
  }

  submitCourseRequestBtn.disabled = false;
  submitCourseRequestBtn.textContent = "Submit Request";
});

// ==========================
// LOAD THIS LECTURER'S PAST COURSE REQUESTS
// ==========================
async function loadMyCourseRequests() {
  if (!currentLecturer) return;

  try {
    const requestsQuery = query(
      collection(db, "courseRequests"),
      where("requestedBy", "==", currentLecturer.uid),
      orderBy("createdAt", "desc")
    );

    const snapshot = await getDocs(requestsQuery);

    if (snapshot.empty) {
      courseRequestList.innerHTML = `<p class="placeholder-text">No requests yet.</p>`;
      return;
    }

    let html = "";
    snapshot.forEach((docSnap) => {
      const req = docSnap.data();
      const statusLabel = req.status.charAt(0).toUpperCase() + req.status.slice(1);

      html += `
        <div class="history-item">
          <div class="history-item-info">
            <h4>${req.courseName}</h4>
            <p>${req.courseCode || ""}</p>
          </div>
          <span class="history-badge ${req.status}">${statusLabel}</span>
        </div>
      `;
    });

    courseRequestList.innerHTML = html;

  } catch (error) {
    console.error("Error loading course requests:", error);
    courseRequestList.innerHTML = `<p class="placeholder-text">Error: ${error.message || error}</p>`;
  }
}

// ==========================
// LOAD SESSION HISTORY + OVERVIEW STATS
// ==========================
async function loadSessionHistory() {
  if (!currentLecturer) return;

  try {
    const sessionsQuery = query(
      collection(db, "sessions"),
      where("lecturerUid", "==", currentLecturer.uid),
      orderBy("createdAt", "desc")
    );

    const snapshot = await getDocs(sessionsQuery);

    if (snapshot.empty) {
      sessionHistoryList.innerHTML = `<p class="placeholder-text">No sessions created yet.</p>`;
      sessionCountEl.textContent = "0";
      totalAttendanceEl.textContent = "0";
      return;
    }

    let sessionCount = 0;
    let totalCheckIns = 0;
    let historyHTML = "";

    snapshot.forEach((docSnap) => {
      const session = docSnap.data();
      sessionCount++;
      totalCheckIns += session.checkInCount || 0;

      const dateText = session.createdAt && session.createdAt.toDate
        ? session.createdAt.toDate().toLocaleString()
        : "Just now";

      const statusClass = session.active ? "active" : "ended";
      const statusLabel = session.active ? "🟢 Active" : "Ended";

      historyHTML += `
        <div class="history-item">
          <div class="history-item-info">
            <h4>${session.courseName}</h4>
            <p>${dateText}</p>
          </div>
          <span class="history-badge ${statusClass}">${statusLabel}</span>
        </div>
      `;
    });

    sessionHistoryList.innerHTML = historyHTML;
    sessionCountEl.textContent = sessionCount.toString();
    totalAttendanceEl.textContent = totalCheckIns.toString();

  } catch (error) {
    console.error("Error loading session history:", error);
    sessionHistoryList.innerHTML = `<p class="placeholder-text">Error: ${error.message || error}</p>`;
  }
}

// Update the course count stat too, once courses are loaded
async function updateCourseCount() {
  if (!currentLecturer) return;
  try {
    const coursesQuery = query(
      collection(db, "courses"),
      where("schoolId", "==", currentLecturer.schoolId)
    );
    const coursesSnapshot = await getDocs(coursesQuery);
    courseCountEl.textContent = coursesSnapshot.size.toString();
  } catch (error) {
    console.error("Error counting courses:", error);
  }
}

// ==========================
// LOAD COURSES INTO DROPDOWN
// ==========================
async function loadCourses() {
  if (!currentLecturer) return;

  try {
    const coursesQuery = query(
      collection(db, "courses"),
      where("schoolId", "==", currentLecturer.schoolId)
    );
    const coursesSnapshot = await getDocs(coursesQuery);

    courseSelect.innerHTML = ""; // clear "Loading courses..."

    if (coursesSnapshot.empty) {
      courseSelect.innerHTML = `<option value="">No courses found</option>`;
    } else {
      coursesSnapshot.forEach((docSnap) => {
        const course = docSnap.data();
        const option = document.createElement("option");
        option.value = course.courseName;
        option.textContent = `${course.courseCode || ""} - ${course.courseName}`.trim();
        courseSelect.appendChild(option);
      });
    }

    // Always add an "Other" option at the end
    const otherOption = document.createElement("option");
    otherOption.value = "other";
    otherOption.textContent = "Other (type manually)";
    courseSelect.appendChild(otherOption);

    updateCourseCount();

  } catch (error) {
    console.error("Error loading courses:", error);
    courseSelect.innerHTML = `<option value="">Could not load courses</option>`;
  }
}

// Show/hide the "type manually" box when "Other" is selected
courseSelect.addEventListener("change", () => {
  if (courseSelect.value === "other") {
    otherCourseGroup.style.display = "block";
  } else {
    otherCourseGroup.style.display = "none";
  }
});

// ==========================
// GET GPS LOCATION (returns a Promise)
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

// ==========================
// START SESSION
// ==========================
startSessionBtn.addEventListener("click", async () => {
  const selectedValue = courseSelect.value;
  let finalCourseName = selectedValue;

  if (selectedValue === "other") {
    finalCourseName = otherCourseInput.value.trim();
  }

  if (!finalCourseName || finalCourseName === "") {
    sessionFormMessage.textContent = "Please select or enter a course.";
    sessionFormMessage.className = "form-message error";
    return;
  }

  if (!currentLecturer) {
    sessionFormMessage.textContent = "Lecturer info not loaded yet. Please wait a moment.";
    sessionFormMessage.className = "form-message error";
    return;
  }

  sessionFormMessage.textContent = "";
  startSessionBtn.disabled = true;
  startSessionBtn.textContent = "📍 Capturing GPS location...";

  try {
    // 1. Capture GPS — this will prompt the browser's location permission
    const location = await getCurrentLocation();

    // 2. Create the session document in Firestore
    const sessionRef = await addDoc(collection(db, "sessions"), {
      courseName: finalCourseName,
      lecturerUid: currentLecturer.uid,
      lecturerName: currentLecturer.fullName,
      department: currentLecturer.department,
      schoolId: currentLecturer.schoolId,
      latitude: location.latitude,
      longitude: location.longitude,
      gpsAccuracy: location.accuracy,
      active: true,
      createdAt: serverTimestamp()
    });

    currentSessionId = sessionRef.id;

    // 3. Show the active session card with QR code
    activeCourseText.textContent = finalCourseName;
    sessionIdText.textContent = currentSessionId;

    // Generate the QR code — encodes the session ID so students can scan it
    qrCodeContainer.innerHTML = "";
    new QRCode(qrCodeContainer, {
      text: currentSessionId,
      width: 220,
      height: 220
    });

    sessionFormCard.style.display = "none";
    activeSessionCard.style.display = "block";

    // Refresh the history list and stats to include this new session
    loadSessionHistory();

  } catch (error) {
    console.error("Error starting session:", error);

    // TEMPORARY: show the full error detail on screen for debugging
    let debugMsg = `Error: ${error.message || error}`;
    if (error.code) debugMsg += ` (code: ${error.code})`;

    if (error.code === 1) {
      sessionFormMessage.textContent = "Location permission denied. GPS is required to start a session.";
    } else {
      sessionFormMessage.textContent = debugMsg;
    }
    sessionFormMessage.className = "form-message error";

    startSessionBtn.disabled = false;
    startSessionBtn.textContent = "📍 Start Session (captures GPS)";
  }
});

// ==========================
// END SESSION
// ==========================
endSessionBtn.addEventListener("click", async () => {
  if (!currentSessionId) return;

  endSessionBtn.disabled = true;
  endSessionBtn.textContent = "Ending session...";

  try {
    await updateDoc(doc(db, "sessions", currentSessionId), {
      active: false,
      endedAt: serverTimestamp()
    });

    // Reset UI back to the form
    currentSessionId = null;
    activeSessionCard.style.display = "none";
    sessionFormCard.style.display = "block";
    startSessionBtn.disabled = false;
    startSessionBtn.textContent = "📍 Start Session (captures GPS)";
    courseSelect.value = "";
    otherCourseInput.value = "";
    otherCourseGroup.style.display = "none";
    sessionFormMessage.textContent = "";

    // Refresh the history list and stats to reflect the ended session
    loadSessionHistory();

  } catch (error) {
    console.error("Error ending session:", error);
    endSessionBtn.disabled = false;
    endSessionBtn.textContent = "🔴 End Session";
  }
});

// ==========================
// SIDEBAR TAB SWITCHING
// ==========================
const navItems = document.querySelectorAll(".nav-item");
const sections = document.querySelectorAll(".dashboard-section");

navItems.forEach((item) => {
  item.addEventListener("click", (e) => {
    e.preventDefault();

    const targetSection = item.getAttribute("data-section");

    // Update active nav item
    navItems.forEach((nav) => nav.classList.remove("active"));
    item.classList.add("active");

    // Show matching section, hide others
    sections.forEach((section) => {
      section.classList.toggle("active", section.id === targetSection);
    });
  });
});
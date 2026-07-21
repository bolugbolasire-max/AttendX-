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
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { initSessionLock } from "./session-lock.js";

// Cap on how many attendee/history rows we render in one go. Keeps a
// session with a large class (e.g. 200 students) from stalling the page
// or downloading an oversized payload just to show a list.
const LIST_DISPLAY_LIMIT = 300;

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
const exportPdfBtn = document.getElementById("exportPdfBtn");
const attendeeTableContainer = document.getElementById("attendeeTableContainer");
const courseReportSelect = document.getElementById("courseReportSelect");
const courseReportContainer = document.getElementById("courseReportContainer");

// New overview stat elements
const totalStudentsStatEl = document.getElementById("totalStudentsStat");
const todaySessionsStatEl = document.getElementById("todaySessionsStat");
const activeSessionsStatEl = document.getElementById("activeSessionsStat");
const attendancePercentStatEl = document.getElementById("attendancePercentStat");

// My Courses search/filter elements
const courseSearchInput = document.getElementById("courseSearchInput");
const courseLevelFilter = document.getElementById("courseLevelFilter");
const courseSemesterFilter = document.getElementById("courseSemesterFilter");

// QR expiry / download elements
const qrExpiryMinutesInput = document.getElementById("qrExpiryMinutes");
const qrExpiryText = document.getElementById("qrExpiryText");
const downloadQrBtn = document.getElementById("downloadQrBtn");

// Student Attendance section elements
const studentCourseSelect = document.getElementById("studentCourseSelect");
const studentSearchInput = document.getElementById("studentSearchInput");
const studentAttendanceMessage = document.getElementById("studentAttendanceMessage");
const studentListContainer = document.getElementById("studentListContainer");

// Analytics elements
const analyticsSessionsCount = document.getElementById("analyticsSessionsCount");
const analyticsPresentCount = document.getElementById("analyticsPresentCount");
const analyticsAbsentCount = document.getElementById("analyticsAbsentCount");
const attendanceTrendContainer = document.getElementById("attendanceTrendContainer");
const courseComparisonContainer = document.getElementById("courseComparisonContainer");

let lecturerSessions = []; // cache of this lecturer's sessions, used by the Reports dropdown
let allCoursesForLecturer = []; // cache of this school's courses, used by search/filter/dropdowns
let currentQrExpiryTimer = null; // handle for the QR expiry countdown, cleared on session end

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

    // A Super Admin can disable an individual account (separate from
    // suspending the whole school). Block them here before anything
    // else loads — being signed in to Firebase Auth is not the same
    // as being allowed to use the dashboard.
    if (userData.status === "disabled") {
      await signOut(auth);
      window.location.href = "account-disabled.html";
      return;
    }

    if (!userData.schoolId) {
      // Lecturer accounts should always be created by a School Admin, which
      // stamps schoolId onto the profile. If it's missing, something's off.
      welcomeMessage.textContent = "No school assigned to this account. Contact your school admin.";
      loadingScreen.style.display = "none";
      dashboardContent.style.display = "flex";
      return;
    }

    // Check the school's status BEFORE rendering anything further. This
    // runs before the dashboard is revealed, so a lecturer whose school
    // was already suspended never sees any dashboard content — the live
    // listener further below only handles suspension happening DURING
    // an active session.
    const schoolCheckSnap = await getDoc(doc(db, "schools", userData.schoolId));
    if (schoolCheckSnap.exists() && schoolCheckSnap.data().status === "suspended") {
      window.location.href = "school-suspended.html";
      return;
    }

    // Populate the dashboard with this lecturer's real data from Firestore
    welcomeMessage.textContent = `Welcome, ${userData.fullName || "Lecturer"}`;
    departmentLine.textContent = userData.department || "";
    userEmail.textContent = userData.email || user.email;

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

    // Start the inactivity lock/logout system for this session.
    initSessionLock({
      uid: user.uid,
      email: userData.email || user.email,
      role: userData.role,
      loginPage: "lecturer-login.html"
    });

    // Live-watch this lecturer's school for suspension. If a Super Admin
    // suspends the school while the lecturer is actively using the
    // dashboard, this kicks them out immediately rather than waiting
    // for their next login.
    onSnapshot(doc(db, "schools", currentLecturer.schoolId), (schoolSnap) => {
      if (schoolSnap.exists() && schoolSnap.data().status === "suspended") {
        signOut(auth).then(() => {
          window.location.href = "school-suspended.html";
        });
      }
    });

    // Live-watch this lecturer's own account. If a Super Admin disables
    // this account (or "force logs out" a user, which does the same
    // thing) while they're actively using the dashboard, this signs
    // them out immediately instead of waiting for their next login.
    onSnapshot(doc(db, "users", user.uid), (userSnap) => {
      if (userSnap.exists() && userSnap.data().status === "disabled") {
        signOut(auth).then(() => {
          window.location.href = "account-disabled.html";
        });
      }
    });

    // Load courses for the session dropdown
    loadCourses();

    // Load this lecturer's session history and overview stats
    loadSessionHistory();

    // Load the course list display and this lecturer's past requests
    loadCourseListDisplay();
    loadMyCourseRequests();

    // Load sessions into the Reports dropdown
    loadReportSessionOptions();

    // Load courses into the Course Report and Student Attendance dropdowns
    loadCourseReportOptions();
    loadStudentCourseOptions();

    // Load Analytics section data
    loadAnalytics();

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
    const checkInsQuery = query(
      collection(db, "checkIns"),
      where("sessionId", "==", sessionId),
      limit(LIST_DISPLAY_LIMIT)
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

    if (snapshot.size >= LIST_DISPLAY_LIMIT) {
      tableHTML += `<p class="placeholder-text">Showing the first ${LIST_DISPLAY_LIMIT} attendees. Export to CSV to see everyone.</p>`;
    }

    attendeeTableContainer.innerHTML = tableHTML;

  } catch (error) {
    console.error("Error loading attendees:", error);
    attendeeTableContainer.innerHTML = `<p class="placeholder-text">Couldn't load attendees right now — check your connection and reselect the session.</p>`;
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
    reportMessage.textContent = "Couldn't export this session right now. Please try again.";
    reportMessage.className = "form-message error";
  }
});

// ==========================
// EXPORT ATTENDANCE AS PDF
// ==========================
exportPdfBtn.addEventListener("click", async () => {
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

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF();

    pdf.setFontSize(16);
    pdf.text(session ? session.courseName : "Attendance Report", 14, 18);
    pdf.setFontSize(10);
    pdf.setTextColor(100);
    const dateText = session && session.createdAt && session.createdAt.toDate
      ? session.createdAt.toDate().toLocaleString()
      : "";
    pdf.text(dateText, 14, 25);

    let y = 38;
    pdf.setFontSize(11);
    pdf.setTextColor(0);
    pdf.text("Name", 14, y);
    pdf.text("Matric Number", 90, y);
    pdf.text("Check-in Time", 145, y);
    y += 4;
    pdf.line(14, y, 196, y);
    y += 6;

    if (snapshot.empty) {
      pdf.setTextColor(120);
      pdf.text("No check-ins recorded for this session.", 14, y);
    } else {
      snapshot.forEach((docSnap) => {
        const checkIn = docSnap.data();
        const timeText = checkIn.checkedInAt && checkIn.checkedInAt.toDate
          ? checkIn.checkedInAt.toDate().toLocaleString()
          : "";

        if (y > 280) {
          pdf.addPage();
          y = 20;
        }

        pdf.setFontSize(10);
        pdf.text(String(checkIn.studentName || ""), 14, y);
        pdf.text(String(checkIn.matricNumber || ""), 90, y);
        pdf.text(timeText, 145, y);
        y += 7;
      });
    }

    const fileName = session ? `${session.courseName}-attendance.pdf` : "attendance.pdf";
    pdf.save(fileName.replace(/\s+/g, "_"));

    reportMessage.textContent = "PDF downloaded successfully.";
    reportMessage.className = "form-message success";

  } catch (error) {
    console.error("Error exporting PDF:", error);
    reportMessage.textContent = "Couldn't export this session right now. Please try again.";
    reportMessage.className = "form-message error";
  }
});

// ==========================
// COURSE-LEVEL REPORT
// ==========================
async function loadCourseReportOptions() {
  if (!currentLecturer) return;
  try {
    if (allCoursesForLecturer.length === 0) await loadCourseListDisplay();

    courseReportSelect.innerHTML = `<option value="">Select a course...</option>` +
      allCoursesForLecturer
        .filter((c) => !c.archived)
        .map((c) => `<option value="${escapeHtmlLect(c.courseName)}">${escapeHtmlLect(c.courseCode || "")} - ${escapeHtmlLect(c.courseName)}</option>`)
        .join("");

  } catch (error) {
    console.error("Error loading course report options:", error);
    courseReportSelect.innerHTML = `<option value="">Could not load courses</option>`;
  }
}

courseReportSelect.addEventListener("change", async () => {
  const courseName = courseReportSelect.value;

  if (!courseName) {
    courseReportContainer.innerHTML = `<p class="placeholder-text">Select a course above to see its report.</p>`;
    return;
  }

  const relevantSessions = lecturerSessions.filter((s) => s.courseName === courseName);

  if (relevantSessions.length === 0) {
    courseReportContainer.innerHTML = `<p class="placeholder-text">No sessions held for this course yet.</p>`;
    return;
  }

  courseReportContainer.innerHTML = `<p class="placeholder-text">Loading report...</p>`;

  const totalSessions = relevantSessions.length;
  const totalCheckIns = relevantSessions.reduce((sum, s) => sum + (s.checkInCount || 0), 0);
  const avgPerSession = Math.round(totalCheckIns / totalSessions);

  let attendanceLine = "";
  try {
    const enrollQuery = query(
      collection(db, "enrollments"),
      where("schoolId", "==", currentLecturer.schoolId),
      where("courseName", "==", courseName),
      where("status", "==", "active")
    );
    const enrollSnap = await getDocs(enrollQuery);
    const enrolledCount = enrollSnap.size;

    if (enrolledCount > 0) {
      const expected = enrolledCount * totalSessions;
      const rate = Math.round((totalCheckIns / expected) * 100);
      attendanceLine = ` · ${rate}% attendance (${enrolledCount} enrolled)`;
    } else {
      attendanceLine = " · No students enrolled yet";
    }
  } catch (error) {
    console.error("Error loading enrollment count for course report:", error);
  }

  courseReportContainer.innerHTML = `
    <div class="history-item">
      <div class="history-item-info">
        <h4>${totalSessions} session${totalSessions === 1 ? "" : "s"} held</h4>
        <p>${totalCheckIns} total check-ins · ${avgPerSession} avg. per session${attendanceLine}</p>
      </div>
    </div>
  `;
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

    allCoursesForLecturer = [];
    coursesSnapshot.forEach((docSnap) => {
      allCoursesForLecturer.push({ id: docSnap.id, ...docSnap.data() });
    });

    // Populate the level filter dropdown with whatever distinct levels
    // actually exist in this school's courses.
    const levels = [...new Set(allCoursesForLecturer.map((c) => c.level).filter(Boolean))].sort();
    courseLevelFilter.innerHTML = `<option value="">All levels</option>` +
      levels.map((lvl) => `<option value="${escapeHtmlLect(lvl)}">${escapeHtmlLect(lvl)}</option>`).join("");

    renderCourseListDisplay();

  } catch (error) {
    console.error("Error loading course list:", error);
    courseListDisplay.innerHTML = `<p class="placeholder-text">Couldn't load courses right now — check your connection and try refreshing.</p>`;
  }
}

// Renders allCoursesForLecturer into the My Courses list, applying the
// current search text and level/semester filters. Called on load and
// on every search/filter input change — no re-fetch needed.
function renderCourseListDisplay() {
  const searchTerm = (courseSearchInput.value || "").trim().toLowerCase();
  const levelFilterVal = courseLevelFilter.value;
  const semesterFilterVal = courseSemesterFilter.value;

  const filtered = allCoursesForLecturer.filter((course) => {
    if (course.archived) return false;
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
    courseListDisplay.innerHTML = `<p class="placeholder-text">${allCoursesForLecturer.length === 0 ? "No courses available yet." : "No courses match your search/filter."}</p>`;
    return;
  }

  let html = "";
  filtered.forEach((course) => {
    html += `
      <div class="history-item">
        <div class="history-item-info">
          <h4>${escapeHtmlLect(course.courseName)}</h4>
          <p>${escapeHtmlLect(course.courseCode || "")} ${course.department ? "· " + escapeHtmlLect(course.department) : ""} ${course.level ? "· Level " + escapeHtmlLect(course.level) : ""} ${course.semester ? "· " + escapeHtmlLect(course.semester) + " Semester" : ""} ${course.unit ? "· " + course.unit + " unit" + (course.unit === 1 ? "" : "s") : ""}</p>
        </div>
      </div>
    `;
  });

  courseListDisplay.innerHTML = html;
}

courseSearchInput.addEventListener("input", renderCourseListDisplay);
courseLevelFilter.addEventListener("change", renderCourseListDisplay);
courseSemesterFilter.addEventListener("change", renderCourseListDisplay);

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
    courseRequestMessage.textContent = "Couldn't submit your request right now. Please try again.";
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
    courseRequestList.innerHTML = `<p class="placeholder-text">Couldn't load your requests right now — check your connection and try refreshing.</p>`;
  }
}

// ==========================
// LOAD SESSION HISTORY + OVERVIEW STATS
// ==========================
async function loadSessionHistory() {
  if (!currentLecturer) return;

  sessionHistoryList.innerHTML = `<p class="placeholder-text">Loading sessions...</p>`;

  try {
    const sessionsQuery = query(
      collection(db, "sessions"),
      where("lecturerUid", "==", currentLecturer.uid),
      orderBy("createdAt", "desc"),
      limit(LIST_DISPLAY_LIMIT)
    );

    const snapshot = await getDocs(sessionsQuery);

    if (snapshot.empty) {
      sessionHistoryList.innerHTML = `<p class="placeholder-text">No sessions created yet.</p>`;
      sessionCountEl.textContent = "0";
      totalAttendanceEl.textContent = "0";
      todaySessionsStatEl.textContent = "0";
      activeSessionsStatEl.textContent = "0";
      totalStudentsStatEl.textContent = "0";
      attendancePercentStatEl.textContent = "0%";
      return;
    }

    let sessionCount = 0;
    let totalCheckIns = 0;
    let todayCount = 0;
    let activeCount = 0;
    let historyHTML = "";

    const todayStr = new Date().toDateString();

    lecturerSessions = [];

    snapshot.forEach((docSnap) => {
      const session = docSnap.data();
      const sessionData = { id: docSnap.id, ...session };
      lecturerSessions.push(sessionData);

      sessionCount++;
      const thisCheckInCount = session.checkInCount || 0;
      totalCheckIns += thisCheckInCount;

      if (session.active) activeCount++;

      const sessionDate = session.createdAt && session.createdAt.toDate
        ? session.createdAt.toDate()
        : null;

      if (sessionDate && sessionDate.toDateString() === todayStr) {
        todayCount++;
      }

      const dateText = sessionDate ? sessionDate.toLocaleString() : "Just now";
      const statusClass = session.active ? "active" : "ended";
      const statusLabel = session.active ? "🟢 Active" : "Ended";

      // A session can only be deleted if no attendance has been
      // recorded for it yet (checkInCount is 0 or missing) — this
      // preserves attendance records the same way lecturer deletion does
      // on the admin side.
      const canDelete = thisCheckInCount === 0;

      historyHTML += `
        <div class="history-item">
          <div class="history-item-info">
            <h4>${escapeHtmlLect(session.courseName)}</h4>
            <p>${dateText} · ${thisCheckInCount} check-in${thisCheckInCount === 1 ? "" : "s"}</p>
          </div>
          <div class="lecturer-row-actions">
            <span class="history-badge ${statusClass}">${statusLabel}</span>
            <button type="button" class="edit-session-btn" data-id="${docSnap.id}">✏️ Edit</button>
            ${canDelete
              ? `<button type="button" class="danger delete-session-btn" data-id="${docSnap.id}">🗑 Delete</button>`
              : ""
            }
          </div>
        </div>
      `;
    });

    sessionHistoryList.innerHTML = historyHTML;
    sessionCountEl.textContent = sessionCount.toString();
    totalAttendanceEl.textContent = totalCheckIns.toString();
    todaySessionsStatEl.textContent = todayCount.toString();
    activeSessionsStatEl.textContent = activeCount.toString();

    // Real attendance percentage: total check-ins across this lecturer's
    // sessions, divided by (enrolled students × sessions held), summed
    // per course. This replaces the earlier "fill rate vs. best session"
    // estimate now that enrollment data actually exists.
    updateAttendancePercentStat();

    // Total unique students seen, across all this lecturer's sessions —
    // requires reading checkIns, so it's computed separately below
    // rather than blocking the history render above.
    updateTotalStudentsStat();

    // Wire up the new per-row actions
    document.querySelectorAll(".edit-session-btn").forEach((btn) => {
      btn.addEventListener("click", () => openEditSessionPrompt(btn.getAttribute("data-id")));
    });
    document.querySelectorAll(".delete-session-btn").forEach((btn) => {
      btn.addEventListener("click", () => confirmDeleteSession(btn.getAttribute("data-id")));
    });

  } catch (error) {
    console.error("Error loading session history:", error);
    sessionHistoryList.innerHTML = `<p class="placeholder-text">Couldn't load your sessions right now — check your connection and try refreshing.</p>`;
  }
}

// Counts distinct students (by matricNumber, falling back to studentUid)
// who have checked into any of this lecturer's sessions.
async function updateTotalStudentsStat() {
  if (!currentLecturer || lecturerSessions.length === 0) {
    totalStudentsStatEl.textContent = "0";
    return;
  }

  try {
    const sessionIds = lecturerSessions.map((s) => s.id);
    const uniqueStudents = new Set();

    // Firestore "in" queries cap at 30 values, so batch if needed.
    const batches = [];
    for (let i = 0; i < sessionIds.length; i += 30) {
      batches.push(sessionIds.slice(i, i + 30));
    }

    for (const batch of batches) {
      const checkInsQuery = query(
        collection(db, "checkIns"),
        where("sessionId", "in", batch)
      );
      const snapshot = await getDocs(checkInsQuery);
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        uniqueStudents.add(data.matricNumber || data.studentUid || docSnap.id);
      });
    }

    totalStudentsStatEl.textContent = uniqueStudents.size.toString();

  } catch (error) {
    console.error("Error computing total students stat:", error);
  }
}

// Real attendance percentage, using actual enrollment counts. For each
// of this lecturer's courses: (check-ins for that course) ÷
// (enrolled students × sessions held for that course). Summed across
// all courses, then expressed as one overall percentage. Replaces the
// earlier "fill rate vs. best session" estimate now that the
// enrollments collection exists.
async function updateAttendancePercentStat() {
  if (!currentLecturer || lecturerSessions.length === 0) {
    attendancePercentStatEl.textContent = "0%";
    return;
  }

  try {
    const courseNames = [...new Set(lecturerSessions.map((s) => s.courseName))];

    let totalExpected = 0;
    let totalPresent = 0;

    for (const courseName of courseNames) {
      const sessionsForCourse = lecturerSessions.filter((s) => s.courseName === courseName);
      const sessionsHeld = sessionsForCourse.length;
      const presentCount = sessionsForCourse.reduce((sum, s) => sum + (s.checkInCount || 0), 0);

      const enrollQuery = query(
        collection(db, "enrollments"),
        where("schoolId", "==", currentLecturer.schoolId),
        where("courseName", "==", courseName),
        where("status", "==", "active")
      );
      const enrollSnap = await getDocs(enrollQuery);
      const enrolledCount = enrollSnap.size;

      if (enrolledCount > 0) {
        totalExpected += enrolledCount * sessionsHeld;
        totalPresent += presentCount;
      }
    }

    const rate = totalExpected > 0 ? Math.round((totalPresent / totalExpected) * 100) : 0;
    attendancePercentStatEl.textContent = totalExpected > 0 ? `${rate}%` : "No enrollment data";

  } catch (error) {
    console.error("Error computing attendance percentage:", error);
    attendancePercentStatEl.textContent = "0%";
  }
}

function escapeHtmlLect(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
// SESSION-STARTED NOTIFICATIONS
// Looks up everyone actively enrolled in this course at this school,
// and writes one "notifications" doc per student. Fire-and-forget from
// the caller's perspective — errors are logged, never thrown, so a
// notification problem can never prevent a session from starting.
// ==========================
async function notifyEnrolledStudentsOfNewSession(courseName, schoolId) {
  try {
    const enrollQuery = query(
      collection(db, "enrollments"),
      where("schoolId", "==", schoolId),
      where("courseName", "==", courseName),
      where("status", "==", "active")
    );
    const enrollSnap = await getDocs(enrollQuery);

    if (enrollSnap.empty) return;

    const writes = enrollSnap.docs.map((enrollDoc) => {
      const studentUid = enrollDoc.data().studentUid;
      if (!studentUid) return null;

      return addDoc(collection(db, "notifications"), {
        studentUid,
        type: "session-started",
        title: "New session started",
        body: `A new session has started for ${courseName}.`,
        courseName,
        read: false,
        createdAt: serverTimestamp(),
        readAt: null
      });
    }).filter(Boolean);

    await Promise.all(writes);
  } catch (error) {
    console.error("Failed to notify enrolled students of new session:", error);
  }
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

    // Determine QR expiry — defaults to 15 minutes if left blank/invalid
    const expiryMinutesRaw = parseInt(qrExpiryMinutesInput.value, 10);
    const expiryMinutes = (Number.isFinite(expiryMinutesRaw) && expiryMinutesRaw > 0) ? expiryMinutesRaw : 15;
    const expiresAtMs = Date.now() + expiryMinutes * 60 * 1000;

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
      qrExpiryMinutes: expiryMinutes,
      qrExpiresAt: expiresAtMs,
      createdAt: serverTimestamp()
    });

    currentSessionId = sessionRef.id;

    // Notify every student enrolled in this course that a session has
    // started. This never blocks the session itself: if the enrollment
    // lookup or any notification write fails, the lecturer still gets
    // their active session and QR code — we just log the problem.
    notifyEnrolledStudentsOfNewSession(finalCourseName, currentLecturer.schoolId);

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

    // Start a live countdown showing when the QR will expire, and
    // automatically end the session once time is up so a stale QR
    // code can't keep accepting check-ins indefinitely.
    startQrExpiryCountdown(expiresAtMs);

    sessionFormCard.style.display = "none";
    activeSessionCard.style.display = "block";

    // Refresh the history list and stats to include this new session
    loadSessionHistory();

  } catch (error) {
    console.error("Error starting session:", error);

    if (error.code === 1) {
      sessionFormMessage.textContent = "Location permission denied. GPS is required to start a session.";
    } else if (error.code === 2 || error.code === 3) {
      sessionFormMessage.textContent = "Couldn't get your location. Please check your device's location settings and try again.";
    } else {
      sessionFormMessage.textContent = "Something went wrong starting the session. Please try again.";
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
    if (currentQrExpiryTimer) {
      clearInterval(currentQrExpiryTimer);
      currentQrExpiryTimer = null;
    }
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
// QR EXPIRY COUNTDOWN
// ==========================
// Shows a live "expires in Xm Ys" line and, once the timer runs out,
// automatically ends the session so the QR code stops accepting
// check-ins rather than staying valid forever.
function startQrExpiryCountdown(expiresAtMs) {
  if (currentQrExpiryTimer) clearInterval(currentQrExpiryTimer);

  function tick() {
    const remainingMs = expiresAtMs - Date.now();

    if (remainingMs <= 0) {
      qrExpiryText.textContent = "⏰ QR code expired — ending session...";
      clearInterval(currentQrExpiryTimer);
      currentQrExpiryTimer = null;
      if (currentSessionId) {
        endSessionBtn.click();
      }
      return;
    }

    const minutes = Math.floor(remainingMs / 60000);
    const seconds = Math.floor((remainingMs % 60000) / 1000);
    qrExpiryText.textContent = `⏳ QR expires in ${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }

  tick();
  currentQrExpiryTimer = setInterval(tick, 1000);
}

// ==========================
// DOWNLOAD QR CODE AS IMAGE
// ==========================
downloadQrBtn.addEventListener("click", () => {
  const canvas = qrCodeContainer.querySelector("canvas");
  const img = qrCodeContainer.querySelector("img");

  const sourceEl = canvas || img;
  if (!sourceEl) {
    alert("No QR code to download yet.");
    return;
  }

  const link = document.createElement("a");
  link.download = `session-${currentSessionId || "qr"}.png`;
  link.href = canvas ? canvas.toDataURL("image/png") : img.src;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

// ==========================
// EDIT SESSION (course name only — GPS/timing stay locked once created)
// ==========================
async function openEditSessionPrompt(sessionId) {
  const session = lecturerSessions.find((s) => s.id === sessionId);
  if (!session) return;

  const newName = prompt("Edit course name for this session:", session.courseName);
  if (newName === null) return; // cancelled
  const trimmed = newName.trim();
  if (!trimmed || trimmed === session.courseName) return;

  try {
    await updateDoc(doc(db, "sessions", sessionId), { courseName: trimmed });
    loadSessionHistory();
    loadReportSessionOptions();
  } catch (error) {
    console.error("Error editing session:", error);
    alert("Could not update this session. Please try again.");
  }
}

// ==========================
// DELETE SESSION (only allowed when zero attendance has been recorded)
// ==========================
async function confirmDeleteSession(sessionId) {
  const session = lecturerSessions.find((s) => s.id === sessionId);
  if (!session) return;

  if ((session.checkInCount || 0) > 0) {
    alert("This session already has attendance recorded and can't be deleted, to preserve the record.");
    return;
  }

  const ok = confirm(`Delete this session for "${session.courseName}"? This cannot be undone.`);
  if (!ok) return;

  try {
    await deleteDoc(doc(db, "sessions", sessionId));
    loadSessionHistory();
    loadReportSessionOptions();
  } catch (error) {
    console.error("Error deleting session:", error);
    alert("Could not delete this session. Please try again.");
  }
}

// ==========================
// STUDENT ATTENDANCE SECTION
// ==========================
let currentStudentRoster = []; // cache of students for the currently selected course

async function loadStudentCourseOptions() {
  if (!currentLecturer) return;
  try {
    if (allCoursesForLecturer.length === 0) await loadCourseListDisplay();

    studentCourseSelect.innerHTML = `<option value="">Select a course...</option>` +
      allCoursesForLecturer
        .filter((c) => !c.archived)
        .map((c) => `<option value="${escapeHtmlLect(c.courseName)}">${escapeHtmlLect(c.courseCode || "")} - ${escapeHtmlLect(c.courseName)}</option>`)
        .join("");

  } catch (error) {
    console.error("Error loading student course options:", error);
    studentCourseSelect.innerHTML = `<option value="">Could not load courses</option>`;
  }
}

studentCourseSelect.addEventListener("change", async () => {
  const courseName = studentCourseSelect.value;

  if (!courseName) {
    studentListContainer.innerHTML = `<p class="placeholder-text">Select a course above to view students.</p>`;
    currentStudentRoster = [];
    return;
  }

  studentListContainer.innerHTML = `<p class="placeholder-text">Loading students...</p>`;
  studentAttendanceMessage.textContent = "";

  try {
    // Find this lecturer's sessions for the selected course, then pull
    // every check-in across those sessions to build a de-duplicated
    // roster of students who've attended at least once.
    const relevantSessions = lecturerSessions.filter((s) => s.courseName === courseName);

    if (relevantSessions.length === 0) {
      studentListContainer.innerHTML = `<p class="placeholder-text">No sessions have been held for this course yet.</p>`;
      currentStudentRoster = [];
      return;
    }

    const sessionIds = relevantSessions.map((s) => s.id);
    const studentMap = new Map(); // key: matricNumber/uid, value: {name, matric, sessionsAttended}

    const batches = [];
    for (let i = 0; i < sessionIds.length; i += 30) {
      batches.push(sessionIds.slice(i, i + 30));
    }

    for (const batch of batches) {
      const checkInsQuery = query(
        collection(db, "checkIns"),
        where("sessionId", "in", batch)
      );
      const snapshot = await getDocs(checkInsQuery);
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const key = data.matricNumber || data.studentUid || docSnap.id;
        if (!studentMap.has(key)) {
          studentMap.set(key, {
            name: data.studentName || "Unknown",
            matric: data.matricNumber || "",
            sessionsAttended: 0
          });
        }
        studentMap.get(key).sessionsAttended++;
      });
    }

    currentStudentRoster = Array.from(studentMap.values());
    renderStudentRoster();

  } catch (error) {
    console.error("Error loading students for course:", error);
    studentListContainer.innerHTML = `<p class="placeholder-text">Couldn't load students right now — check your connection and try again.</p>`;
  }
});

function renderStudentRoster() {
  const searchTerm = (studentSearchInput.value || "").trim().toLowerCase();

  const filtered = currentStudentRoster.filter((student) => {
    if (!searchTerm) return true;
    const haystack = `${student.name} ${student.matric}`.toLowerCase();
    return haystack.includes(searchTerm);
  });

  if (filtered.length === 0) {
    studentListContainer.innerHTML = `<p class="placeholder-text">${currentStudentRoster.length === 0 ? "No students have checked in for this course yet." : "No students match your search."}</p>`;
    return;
  }

  let tableHTML = `
    <table class="attendee-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Matric Number</th>
          <th>Sessions Attended</th>
        </tr>
      </thead>
      <tbody>
  `;

  filtered.forEach((student) => {
    tableHTML += `
      <tr>
        <td>${escapeHtmlLect(student.name)}</td>
        <td>${escapeHtmlLect(student.matric)}</td>
        <td>${student.sessionsAttended}</td>
      </tr>
    `;
  });

  tableHTML += `</tbody></table>`;
  studentListContainer.innerHTML = tableHTML;
}

studentSearchInput.addEventListener("input", renderStudentRoster);


// ==========================
// ANALYTICS SECTION
// ==========================
async function loadAnalytics() {
  if (!currentLecturer) return;

  try {
    // lecturerSessions is populated by loadSessionHistory/loadReportSessionOptions,
    // both of which run earlier in the load sequence — but guard in case
    // this fires first on a slow connection.
    if (lecturerSessions.length === 0) {
      await loadReportSessionOptions();
    }

    const totalSessions = lecturerSessions.length;
    const totalPresent = lecturerSessions.reduce((sum, s) => sum + (s.checkInCount || 0), 0);

    analyticsSessionsCount.textContent = totalSessions.toString();
    analyticsPresentCount.textContent = totalPresent.toString();

    // "Absent" is an estimate: for each session, we compare its
    // check-in count against the best-attended session for the same
    // course (a stand-in for expected class size, since we don't track
    // enrollment). This is an estimate, not a hard count against a
    // roster — labelled as such in the UI.
    const byCourse = {};
    lecturerSessions.forEach((s) => {
      if (!byCourse[s.courseName]) byCourse[s.courseName] = [];
      byCourse[s.courseName].push(s.checkInCount || 0);
    });

    let estimatedAbsent = 0;
    Object.values(byCourse).forEach((counts) => {
      const maxForCourse = Math.max(...counts, 0);
      counts.forEach((c) => {
        estimatedAbsent += Math.max(maxForCourse - c, 0);
      });
    });
    analyticsAbsentCount.textContent = estimatedAbsent.toString();

    // Trend: last 10 sessions, oldest to newest, as a simple bar list
    const recentSessions = [...lecturerSessions]
      .filter((s) => s.createdAt && s.createdAt.toDate)
      .sort((a, b) => a.createdAt.toDate() - b.createdAt.toDate())
      .slice(-10);

    if (recentSessions.length === 0) {
      attendanceTrendContainer.innerHTML = `<p class="placeholder-text">No session data yet to show a trend.</p>`;
    } else {
      const maxCount = Math.max(...recentSessions.map((s) => s.checkInCount || 0), 1);
      let trendHtml = `<div style="display:flex; align-items:flex-end; gap:10px; height:140px; padding:10px 0;">`;
      recentSessions.forEach((s) => {
        const count = s.checkInCount || 0;
        const heightPct = Math.max((count / maxCount) * 100, 4);
        const dateLabel = s.createdAt.toDate().toLocaleDateString(undefined, { month: "short", day: "numeric" });
        trendHtml += `
          <div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:4px;">
            <span style="font-size:0.75rem; color:var(--text-light);">${count}</span>
            <div style="width:100%; max-width:34px; height:${heightPct}%; background:var(--primary); border-radius:4px 4px 0 0;" title="${escapeHtmlLect(s.courseName)} — ${dateLabel}"></div>
            <span style="font-size:0.7rem; color:var(--text-light); writing-mode:vertical-rl; transform:rotate(180deg); height:50px;">${dateLabel}</span>
          </div>
        `;
      });
      trendHtml += `</div>`;
      attendanceTrendContainer.innerHTML = trendHtml;
    }

    // Course comparison: total check-ins per course
    const courseNames = Object.keys(byCourse);
    if (courseNames.length === 0) {
      courseComparisonContainer.innerHTML = `<p class="placeholder-text">No course data yet.</p>`;
    } else {
      let compHtml = "";
      courseNames.forEach((courseName) => {
        const counts = byCourse[courseName];
        const total = counts.reduce((a, b) => a + b, 0);
        const sessionsForCourse = counts.length;
        compHtml += `
          <div class="history-item">
            <div class="history-item-info">
              <h4>${escapeHtmlLect(courseName)}</h4>
              <p>${sessionsForCourse} session${sessionsForCourse === 1 ? "" : "s"} · ${total} total check-ins</p>
            </div>
          </div>
        `;
      });
      courseComparisonContainer.innerHTML = compHtml;
    }

  } catch (error) {
    console.error("Error loading analytics:", error);
    attendanceTrendContainer.innerHTML = `<p class="placeholder-text">Couldn't load analytics right now — check your connection and try refreshing.</p>`;
    courseComparisonContainer.innerHTML = "";
  }
}


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
// super-admin-dashboard.js
import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signOut,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Cap on how many rows we render in one go, so a platform with many
// schools/admins/students doesn't stall the page or download an
// oversized payload just to show a list.
const LIST_DISPLAY_LIMIT = 300;

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ==========================
// ELEMENT REFERENCES
// ==========================
const loadingScreen = document.getElementById("loadingScreen");
const dashboardContent = document.getElementById("dashboardContent");
const welcomeMessage = document.getElementById("welcomeMessage");
const userEmail = document.getElementById("userEmail");
const logoutBtn = document.getElementById("logoutBtn");

// Overview
const ovSchoolCount = document.getElementById("ovSchoolCount");
const ovAdminCount = document.getElementById("ovAdminCount");
const ovLecturerCount = document.getElementById("ovLecturerCount");
const ovStudentCount = document.getElementById("ovStudentCount");
const ovCourseCount = document.getElementById("ovCourseCount");
const ovSessionCount = document.getElementById("ovSessionCount");
const ovRecentSchools = document.getElementById("ovRecentSchools");

// Schools
const schoolNameInput = document.getElementById("schoolNameInput");
const schoolStatusSelect = document.getElementById("schoolStatusSelect");
const schoolFormMessage = document.getElementById("schoolFormMessage");
const addSchoolBtn = document.getElementById("addSchoolBtn");
const schoolsList = document.getElementById("schoolsList");
const schoolSearchInput = document.getElementById("schoolSearchInput");

// School Admins
const adminFullName = document.getElementById("adminFullName");
const adminEmail = document.getElementById("adminEmail");
const adminPassword = document.getElementById("adminPassword");
const adminSchoolSelect = document.getElementById("adminSchoolSelect");
const adminFormMessage = document.getElementById("adminFormMessage");
const createAdminBtn = document.getElementById("createAdminBtn");
const adminsList = document.getElementById("adminsList");
const adminSearchInput = document.getElementById("adminSearchInput");

// Lecturers
const lecturersList = document.getElementById("lecturersList");
const lecturerSearchInput = document.getElementById("lecturerSearchInput");

// Students
const studentsList = document.getElementById("studentsList");
const studentSearchInput = document.getElementById("studentSearchInput");
const studentAttendanceHint = document.getElementById("studentAttendanceHint");
const studentAttendanceRecords = document.getElementById("studentAttendanceRecords");

// Courses
const coursesList = document.getElementById("coursesList");
const courseSearchInput = document.getElementById("courseSearchInput");

// Attendance
const attTotalSessions = document.getElementById("attTotalSessions");
const attTodaySessions = document.getElementById("attTodaySessions");
const attOverallPercent = document.getElementById("attOverallPercent");
const attRecentList = document.getElementById("attRecentList");

// Security
const blockedAccountsList = document.getElementById("blockedAccountsList");
const suspiciousActivityList = document.getElementById("suspiciousActivityList");
const forceLogoutEmailInput = document.getElementById("forceLogoutEmailInput");
const forceLogoutMessage = document.getElementById("forceLogoutMessage");
const forceLogoutBtn = document.getElementById("forceLogoutBtn");

// ==========================
// IN-MEMORY CACHES (populated on load, filtered locally on search)
// ==========================
let allSchoolsCache = [];
let allAdminsCache = [];
let allLecturersCache = [];
let allStudentsCache = [];
let allCoursesCache = [];
let allSessionsCache = [];

// ==========================
// AUTH GUARD
// ==========================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "super-admin-login.html";
    return;
  }

  try {
    const userDocRef = doc(db, "users", user.uid);
    const userDocSnap = await getDoc(userDocRef);

    if (!userDocSnap.exists() || userDocSnap.data().role !== "superadmin") {
      window.location.href = "super-admin-login.html";
      return;
    }

    const userData = userDocSnap.data();
    welcomeMessage.textContent = `Welcome, ${userData.fullName || "Super Admin"}`;
    userEmail.textContent = userData.email || user.email;

    loadingScreen.style.display = "none";
    dashboardContent.style.display = "flex";

    // Load everything needed for Overview immediately, then let each
    // section lazy-load the rest when its tab is first opened.
    loadOverview();

  } catch (error) {
    console.error("Error loading dashboard:", error);
    window.location.href = "super-admin-login.html";
  }
});

// ==========================
// LOGOUT
// ==========================
logoutBtn.addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.href = "super-admin-login.html";
  } catch (error) {
    console.error("Error signing out:", error);
  }
});

// ============================================================
// OVERVIEW
// ============================================================
async function loadOverview() {
  try {
    const [schoolsSnap, usersSnap, coursesSnap, sessionsSnap] = await Promise.all([
      getDocs(collection(db, "schools")),
      getDocs(collection(db, "users")),
      getDocs(collection(db, "courses")),
      getDocs(collection(db, "sessions"))
    ]);

    allSchoolsCache = [];
    schoolsSnap.forEach((d) => allSchoolsCache.push({ id: d.id, ...d.data() }));

    allAdminsCache = [];
    allLecturersCache = [];
    allStudentsCache = [];
    usersSnap.forEach((d) => {
      const data = { id: d.id, ...d.data() };
      if (data.role === "schooladmin") allAdminsCache.push(data);
      else if (data.role === "lecturer") allLecturersCache.push(data);
      else if (data.role === "student") allStudentsCache.push(data);
    });

    allCoursesCache = [];
    coursesSnap.forEach((d) => allCoursesCache.push({ id: d.id, ...d.data() }));

    allSessionsCache = [];
    sessionsSnap.forEach((d) => allSessionsCache.push({ id: d.id, ...d.data() }));

    ovSchoolCount.textContent = allSchoolsCache.length.toString();
    ovAdminCount.textContent = allAdminsCache.length.toString();
    ovLecturerCount.textContent = allLecturersCache.length.toString();
    ovStudentCount.textContent = allStudentsCache.length.toString();
    ovCourseCount.textContent = allCoursesCache.length.toString();
    ovSessionCount.textContent = allSessionsCache.length.toString();

    // Recently added schools (top 5 by createdAt desc)
    const recent = [...allSchoolsCache]
      .filter((s) => s.createdAt && s.createdAt.toDate)
      .sort((a, b) => b.createdAt.toDate() - a.createdAt.toDate())
      .slice(0, 5);

    if (recent.length === 0) {
      ovRecentSchools.innerHTML = `<p class="placeholder-text">No schools added yet.</p>`;
    } else {
      ovRecentSchools.innerHTML = recent.map((s) => `
        <div class="history-item">
          <div class="history-item-info">
            <h4>${escapeHtml(s.schoolName)}</h4>
            <p>${s.createdAt.toDate().toLocaleDateString()}</p>
          </div>
          <span class="history-badge ${s.status === "active" ? "active" : s.status === "suspended" ? "suspended" : "trial"}">${escapeHtml(s.status || "active")}</span>
        </div>
      `).join("");
    }

    // Now that caches are warm, render whichever section is already
    // showing (in case the user reloads mid-tab), and prep dropdown.
    populateSchoolDropdown();
    renderSchoolsList();
    renderAdminsList();
    renderLecturersList();
    renderStudentsList();
    renderCoursesList();
    loadAttendanceSection();

  } catch (error) {
    console.error("Error loading overview:", error);
  }
}

// ============================================================
// SCHOOLS
// ============================================================
function populateSchoolDropdown() {
  if (allSchoolsCache.length === 0) {
    adminSchoolSelect.innerHTML = `<option value="">No schools available</option>`;
    return;
  }
  adminSchoolSelect.innerHTML = `<option value="">Choose a school...</option>` +
    allSchoolsCache.map((s) => `<option value="${s.id}">${escapeHtml(s.schoolName)}</option>`).join("");
}

addSchoolBtn.addEventListener("click", async () => {
  const schoolName = schoolNameInput.value.trim();
  const status = schoolStatusSelect.value;

  if (!schoolName) {
    schoolFormMessage.textContent = "Please enter a school name.";
    schoolFormMessage.className = "form-message error";
    return;
  }

  addSchoolBtn.disabled = true;
  addSchoolBtn.textContent = "Adding...";

  try {
    await setDoc(doc(collection(db, "schools")), {
      schoolName,
      status,
      createdAt: serverTimestamp()
    });

    schoolFormMessage.textContent = "School added successfully.";
    schoolFormMessage.className = "form-message success";
    schoolNameInput.value = "";
    schoolStatusSelect.value = "active";

    await loadOverview();

  } catch (error) {
    console.error("Error adding school:", error);
    schoolFormMessage.textContent = "Couldn't add this school right now. Please try again.";
    schoolFormMessage.className = "form-message error";
  }

  addSchoolBtn.disabled = false;
  addSchoolBtn.textContent = "Add School";
});

function renderSchoolsList() {
  const searchTerm = (schoolSearchInput.value || "").trim().toLowerCase();

  const filtered = allSchoolsCache.filter((s) => {
    if (!searchTerm) return true;
    return (s.schoolName || "").toLowerCase().includes(searchTerm);
  });

  if (filtered.length === 0) {
    schoolsList.innerHTML = `<p class="placeholder-text">${allSchoolsCache.length === 0 ? "No schools added yet." : "No schools match your search."}</p>`;
    return;
  }

  // Per-school counts, computed from the already-loaded caches (no extra reads)
  schoolsList.innerHTML = filtered.slice(0, LIST_DISPLAY_LIMIT).map((school) => {
    const studentCount = allStudentsCache.filter((u) => u.schoolId === school.id).length;
    const lecturerCount = allLecturersCache.filter((u) => u.schoolId === school.id).length;
    const sessionCount = allSessionsCache.filter((s) => s.schoolId === school.id).length;

    return `
      <div class="history-item" data-school-id="${school.id}">
        <div class="history-item-info">
          <h4>${escapeHtml(school.schoolName)}</h4>
          <p class="secondary-line">${studentCount} students · ${lecturerCount} lecturers · ${sessionCount} sessions</p>
        </div>
        <div class="row-actions">
          <select class="school-status-select small-btn" data-school-id="${school.id}">
            <option value="active" ${school.status === "active" ? "selected" : ""}>Active</option>
            <option value="trial" ${school.status === "trial" ? "selected" : ""}>Trial</option>
            <option value="suspended" ${school.status === "suspended" ? "selected" : ""}>Suspended</option>
          </select>
          <button class="small-btn edit-school-btn" data-school-id="${school.id}" data-school-name="${escapeHtml(school.schoolName)}" type="button">✏️ Edit</button>
          <button class="danger delete-school-btn" data-school-id="${school.id}" data-school-name="${escapeHtml(school.schoolName)}" type="button">🗑️ Delete</button>
        </div>
      </div>
    `;
  }).join("");

  document.querySelectorAll(".school-status-select").forEach((select) => {
    select.addEventListener("change", async () => {
      const schoolId = select.getAttribute("data-school-id");
      const newStatus = select.value;
      try {
        await updateDoc(doc(db, "schools", schoolId), { status: newStatus });
        const cached = allSchoolsCache.find((s) => s.id === schoolId);
        if (cached) cached.status = newStatus;
      } catch (error) {
        console.error("Error updating school status:", error);
        alert("Could not update status. Please try again.");
      }
    });
  });

  document.querySelectorAll(".edit-school-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const schoolId = btn.getAttribute("data-school-id");
      const currentName = btn.getAttribute("data-school-name");
      const newName = prompt("Edit school name:", currentName);
      if (!newName || !newName.trim() || newName.trim() === currentName) return;

      try {
        await updateDoc(doc(db, "schools", schoolId), { schoolName: newName.trim() });
        const cached = allSchoolsCache.find((s) => s.id === schoolId);
        if (cached) cached.schoolName = newName.trim();
        renderSchoolsList();
        populateSchoolDropdown();
      } catch (error) {
        console.error("Error editing school:", error);
        alert("Could not update school name. Please try again.");
      }
    });
  });

  document.querySelectorAll(".delete-school-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const schoolId = btn.getAttribute("data-school-id");
      const schoolName = btn.getAttribute("data-school-name");

      const confirmed = confirm(
        `Delete "${schoolName}"? This cannot be undone. Lecturers, students, and school admins already linked to this school will keep their accounts but lose their school connection.`
      );
      if (!confirmed) return;

      try {
        await deleteDoc(doc(db, "schools", schoolId));
        allSchoolsCache = allSchoolsCache.filter((s) => s.id !== schoolId);
        renderSchoolsList();
        populateSchoolDropdown();
        ovSchoolCount.textContent = allSchoolsCache.length.toString();
      } catch (error) {
        console.error("Error deleting school:", error);
        alert("Could not delete school. Please try again.");
      }
    });
  });
}

schoolSearchInput.addEventListener("input", renderSchoolsList);

// ============================================================
// SCHOOL ADMINS
// ============================================================
createAdminBtn.addEventListener("click", async () => {
  const fullName = adminFullName.value.trim();
  const email = adminEmail.value.trim();
  const password = adminPassword.value;
  const schoolId = adminSchoolSelect.value;

  if (!fullName || !email || !password || !schoolId) {
    adminFormMessage.textContent = "Please fill in all fields.";
    adminFormMessage.className = "form-message error";
    return;
  }

  if (password.length < 6) {
    adminFormMessage.textContent = "Password must be at least 6 characters.";
    adminFormMessage.className = "form-message error";
    return;
  }

  createAdminBtn.disabled = true;
  createAdminBtn.textContent = "Creating...";

  const schoolName = adminSchoolSelect.options[adminSchoolSelect.selectedIndex].textContent;

  let secondaryApp;
  try {
    secondaryApp = initializeApp(auth.app.options, "secondary-" + Date.now());
    const secondaryAuth = getAuth(secondaryApp);

    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const newUser = userCredential.user;

    await setDoc(doc(db, "users", newUser.uid), {
      fullName,
      email,
      role: "schooladmin",
      status: "active",
      schoolId,
      schoolName,
      createdAt: serverTimestamp()
    });

    await signOut(secondaryAuth);

    adminFormMessage.textContent = "School Admin account created successfully.";
    adminFormMessage.className = "form-message success";

    adminFullName.value = "";
    adminEmail.value = "";
    adminPassword.value = "";
    adminSchoolSelect.value = "";

    await loadOverview();

  } catch (error) {
    console.error("Error creating school admin:", error);

    if (error.code === "auth/email-already-in-use") {
      adminFormMessage.textContent = "This email is already registered.";
    } else {
      adminFormMessage.textContent = "Couldn't create this account right now. Please try again.";
    }
    adminFormMessage.className = "form-message error";
  }

  createAdminBtn.disabled = false;
  createAdminBtn.textContent = "Create School Admin";
});

function renderAdminsList() {
  const searchTerm = (adminSearchInput.value || "").trim().toLowerCase();

  const filtered = allAdminsCache.filter((a) => {
    if (!searchTerm) return true;
    const haystack = `${a.fullName || ""} ${a.email || ""} ${a.schoolName || ""}`.toLowerCase();
    return haystack.includes(searchTerm);
  });

  if (filtered.length === 0) {
    adminsList.innerHTML = `<p class="placeholder-text">${allAdminsCache.length === 0 ? "No school admins created yet." : "No admins match your search."}</p>`;
    return;
  }

  adminsList.innerHTML = filtered.slice(0, LIST_DISPLAY_LIMIT).map((admin) => {
    const status = admin.status || "active";
    return `
      <div class="history-item" data-admin-id="${admin.id}">
        <div class="history-item-info">
          <h4>${escapeHtml(admin.fullName || "Unnamed")}</h4>
          <p>${escapeHtml(admin.email || "")}</p>
          <p class="secondary-line">${escapeHtml(admin.schoolName || "No school assigned")}</p>
        </div>
        <div class="row-actions">
          <span class="history-badge ${status === "active" ? "active" : "disabled"}">${escapeHtml(status)}</span>
          <button class="small-btn reset-admin-btn" data-email="${escapeHtml(admin.email || "")}" type="button">🔑 Reset Password</button>
          <button class="danger toggle-admin-btn" data-admin-id="${admin.id}" data-status="${status}" type="button">${status === "active" ? "🚫 Disable" : "✅ Enable"}</button>
        </div>
      </div>
    `;
  }).join("");

  document.querySelectorAll(".reset-admin-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const email = btn.getAttribute("data-email");
      if (!email) return;
      try {
        await sendPasswordResetEmail(auth, email);
        alert(`Password reset email sent to ${email}.`);
      } catch (error) {
        console.error("Error sending reset email:", error);
        alert("Couldn't send reset email. Please try again.");
      }
    });
  });

  document.querySelectorAll(".toggle-admin-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const adminId = btn.getAttribute("data-admin-id");
      const currentStatus = btn.getAttribute("data-status");
      const newStatus = currentStatus === "active" ? "disabled" : "active";

      try {
        await updateDoc(doc(db, "users", adminId), { status: newStatus });
        const cached = allAdminsCache.find((a) => a.id === adminId);
        if (cached) cached.status = newStatus;
        renderAdminsList();
      } catch (error) {
        console.error("Error toggling admin status:", error);
        alert("Could not update this admin's status. Please try again.");
      }
    });
  });
}

adminSearchInput.addEventListener("input", renderAdminsList);

// ============================================================
// LECTURERS
// ============================================================
function renderLecturersList() {
  const searchTerm = (lecturerSearchInput.value || "").trim().toLowerCase();

  const filtered = allLecturersCache.filter((l) => {
    if (!searchTerm) return true;
    const haystack = `${l.fullName || ""} ${l.email || ""} ${l.schoolName || ""} ${l.department || ""}`.toLowerCase();
    return haystack.includes(searchTerm);
  });

  if (filtered.length === 0) {
    lecturersList.innerHTML = `<p class="placeholder-text">${allLecturersCache.length === 0 ? "No lecturers registered yet." : "No lecturers match your search."}</p>`;
    return;
  }

  lecturersList.innerHTML = filtered.slice(0, LIST_DISPLAY_LIMIT).map((lect) => {
    const status = lect.status || "active";
    return `
      <div class="history-item" data-lecturer-id="${lect.id}">
        <div class="history-item-info">
          <h4>${escapeHtml(lect.fullName || "Unnamed")}</h4>
          <p>${escapeHtml(lect.email || "")}</p>
          <p class="secondary-line">${escapeHtml(lect.schoolName || "No school")} ${lect.department ? "· " + escapeHtml(lect.department) : ""}</p>
        </div>
        <div class="row-actions">
          <span class="history-badge ${status === "active" ? "active" : "disabled"}">${escapeHtml(status)}</span>
          <button class="danger toggle-lecturer-btn" data-lecturer-id="${lect.id}" data-status="${status}" type="button">${status === "active" ? "🚫 Disable" : "✅ Enable"}</button>
        </div>
      </div>
    `;
  }).join("");

  document.querySelectorAll(".toggle-lecturer-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const lecturerId = btn.getAttribute("data-lecturer-id");
      const currentStatus = btn.getAttribute("data-status");
      const newStatus = currentStatus === "active" ? "disabled" : "active";

      try {
        await updateDoc(doc(db, "users", lecturerId), { status: newStatus });
        const cached = allLecturersCache.find((l) => l.id === lecturerId);
        if (cached) cached.status = newStatus;
        renderLecturersList();
      } catch (error) {
        console.error("Error toggling lecturer status:", error);
        alert("Could not update this lecturer's status. Please try again.");
      }
    });
  });
}

lecturerSearchInput.addEventListener("input", renderLecturersList);

// ============================================================
// STUDENTS
// ============================================================
function renderStudentsList() {
  const searchTerm = (studentSearchInput.value || "").trim().toLowerCase();

  const filtered = allStudentsCache.filter((s) => {
    if (!searchTerm) return true;
    const haystack = `${s.fullName || ""} ${s.matricNumber || ""} ${s.schoolName || ""}`.toLowerCase();
    return haystack.includes(searchTerm);
  });

  if (filtered.length === 0) {
    studentsList.innerHTML = `<p class="placeholder-text">${allStudentsCache.length === 0 ? "No students registered yet." : "No students match your search."}</p>`;
    return;
  }

  studentsList.innerHTML = filtered.slice(0, LIST_DISPLAY_LIMIT).map((student) => `
    <div class="history-item" data-student-id="${student.id}">
      <div class="history-item-info">
        <h4>${escapeHtml(student.fullName || "Unnamed")}</h4>
        <p>${escapeHtml(student.matricNumber || "No matric no.")}</p>
        <p class="secondary-line">${escapeHtml(student.schoolName || "No school")} ${student.level ? "· Level " + escapeHtml(student.level) : ""}</p>
      </div>
      <div class="row-actions">
        <button class="small-btn view-student-attendance-btn" data-student-id="${student.id}" data-student-name="${escapeHtml(student.fullName || "Student")}" data-matric="${escapeHtml(student.matricNumber || "")}" type="button">📍 View Attendance</button>
      </div>
    </div>
  `).join("");

  document.querySelectorAll(".view-student-attendance-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const studentId = btn.getAttribute("data-student-id");
      const studentName = btn.getAttribute("data-student-name");
      const matric = btn.getAttribute("data-matric");
      loadStudentAttendance(studentId, studentName, matric);
    });
  });
}

studentSearchInput.addEventListener("input", renderStudentsList);

async function loadStudentAttendance(studentId, studentName, matric) {
  studentAttendanceHint.textContent = `Showing attendance for ${studentName}${matric ? " (" + matric + ")" : ""}...`;
  studentAttendanceRecords.innerHTML = `<p class="placeholder-text">Loading...</p>`;

  try {
    // checkIns are keyed by studentUid or matricNumber depending on how
    // the student checked in — query both and merge, since either can
    // be the identifying field for a given record.
    const queries = [];
    queries.push(getDocs(query(collection(db, "checkIns"), where("studentUid", "==", studentId), limit(LIST_DISPLAY_LIMIT))));
    if (matric) {
      queries.push(getDocs(query(collection(db, "checkIns"), where("matricNumber", "==", matric), limit(LIST_DISPLAY_LIMIT))));
    }

    const snapshots = await Promise.all(queries);
    const seen = new Set();
    const records = [];

    snapshots.forEach((snap) => {
      snap.forEach((docSnap) => {
        if (seen.has(docSnap.id)) return;
        seen.add(docSnap.id);
        records.push({ id: docSnap.id, ...docSnap.data() });
      });
    });

    if (records.length === 0) {
      studentAttendanceRecords.innerHTML = `<p class="placeholder-text">No attendance records found for this student.</p>`;
      return;
    }

    records.sort((a, b) => {
      const at = a.checkedInAt && a.checkedInAt.toDate ? a.checkedInAt.toDate() : 0;
      const bt = b.checkedInAt && b.checkedInAt.toDate ? b.checkedInAt.toDate() : 0;
      return bt - at;
    });

    studentAttendanceRecords.innerHTML = records.slice(0, LIST_DISPLAY_LIMIT).map((rec) => {
      const timeText = rec.checkedInAt && rec.checkedInAt.toDate ? rec.checkedInAt.toDate().toLocaleString() : "Unknown time";
      const matchedSession = allSessionsCache.find((s) => s.id === rec.sessionId);
      const courseName = (matchedSession && matchedSession.courseName) || rec.courseName || "Unknown course";
      return `
        <div class="history-item">
          <div class="history-item-info">
            <h4>${escapeHtml(courseName)}</h4>
            <p>${timeText}</p>
          </div>
        </div>
      `;
    }).join("");

  } catch (error) {
    console.error("Error loading student attendance:", error);
    studentAttendanceRecords.innerHTML = `<p class="placeholder-text">Couldn't load attendance right now — check your connection and try again.</p>`;
  }
}

// ============================================================
// COURSES
// ============================================================
function renderCoursesList() {
  const searchTerm = (courseSearchInput.value || "").trim().toLowerCase();

  const filtered = allCoursesCache.filter((c) => {
    if (!searchTerm) return true;
    const school = allSchoolsCache.find((s) => s.id === c.schoolId);
    const haystack = `${c.courseName || ""} ${c.courseCode || ""} ${school ? school.schoolName : ""}`.toLowerCase();
    return haystack.includes(searchTerm);
  });

  if (filtered.length === 0) {
    coursesList.innerHTML = `<p class="placeholder-text">${allCoursesCache.length === 0 ? "No courses added yet." : "No courses match your search."}</p>`;
    return;
  }

  coursesList.innerHTML = filtered.slice(0, LIST_DISPLAY_LIMIT).map((course) => {
    const school = allSchoolsCache.find((s) => s.id === course.schoolId);
    return `
      <div class="history-item" data-course-id="${course.id}">
        <div class="history-item-info">
          <h4>${escapeHtml(course.courseName)}</h4>
          <p>${escapeHtml(course.courseCode || "")}</p>
          <p class="secondary-line">${escapeHtml(school ? school.schoolName : "Unknown school")} ${course.level ? "· Level " + escapeHtml(course.level) : ""} ${course.semester ? "· " + escapeHtml(course.semester) + " Semester" : ""}</p>
        </div>
        <div class="row-actions">
          <button class="danger delete-course-btn" data-course-id="${course.id}" data-course-name="${escapeHtml(course.courseName)}" type="button">🗑️ Delete</button>
        </div>
      </div>
    `;
  }).join("");

  document.querySelectorAll(".delete-course-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const courseId = btn.getAttribute("data-course-id");
      const courseName = btn.getAttribute("data-course-name");

      const confirmed = confirm(`Delete "${courseName}"? This removes the course listing. Past attendance sessions and records for it are kept.`);
      if (!confirmed) return;

      try {
        await deleteDoc(doc(db, "courses", courseId));
        allCoursesCache = allCoursesCache.filter((c) => c.id !== courseId);
        renderCoursesList();
        ovCourseCount.textContent = allCoursesCache.length.toString();
      } catch (error) {
        console.error("Error deleting course:", error);
        alert("Could not delete course. Please try again.");
      }
    });
  });
}

courseSearchInput.addEventListener("input", renderCoursesList);

// ============================================================
// ATTENDANCE
// ============================================================
async function loadAttendanceSection() {
  try {
    attTotalSessions.textContent = allSessionsCache.length.toString();

    const todayStr = new Date().toDateString();
    const todaySessions = allSessionsCache.filter((s) => {
      const d = s.createdAt && s.createdAt.toDate ? s.createdAt.toDate() : null;
      return d && d.toDateString() === todayStr;
    });
    attTodaySessions.textContent = todaySessions.length.toString();

    // Overall attendance %: sum of checkInCount across all sessions,
    // compared against enrolled students × sessions per course, summed
    // across all schools/courses — same approach the lecturer dashboard
    // uses, just platform-wide.
    let totalExpected = 0;
    let totalPresent = 0;

    const enrollmentCache = new Map(); // key: schoolId|courseName -> enrolled count

    const byCourseSchool = {};
    allSessionsCache.forEach((s) => {
      const key = `${s.schoolId}|${s.courseName}`;
      if (!byCourseSchool[key]) byCourseSchool[key] = { schoolId: s.schoolId, courseName: s.courseName, sessions: [] };
      byCourseSchool[key].sessions.push(s);
    });

    const keys = Object.keys(byCourseSchool);
    for (const key of keys) {
      const group = byCourseSchool[key];
      const sessionsHeld = group.sessions.length;
      const presentCount = group.sessions.reduce((sum, s) => sum + (s.checkInCount || 0), 0);
      totalPresent += presentCount;

      if (!enrollmentCache.has(key)) {
        try {
          const enrollQuery = query(
            collection(db, "enrollments"),
            where("schoolId", "==", group.schoolId),
            where("courseName", "==", group.courseName),
            where("status", "==", "active")
          );
          const enrollSnap = await getDocs(enrollQuery);
          enrollmentCache.set(key, enrollSnap.size);
        } catch (error) {
          enrollmentCache.set(key, 0);
        }
      }

      const enrolledCount = enrollmentCache.get(key) || 0;
      totalExpected += enrolledCount * sessionsHeld;
    }

    if (totalExpected > 0) {
      attOverallPercent.textContent = `${Math.round((totalPresent / totalExpected) * 100)}%`;
    } else {
      attOverallPercent.textContent = "N/A";
    }

    // Recent sessions list (most recent 20)
    const recent = [...allSessionsCache]
      .filter((s) => s.createdAt && s.createdAt.toDate)
      .sort((a, b) => b.createdAt.toDate() - a.createdAt.toDate())
      .slice(0, 20);

    if (recent.length === 0) {
      attRecentList.innerHTML = `<p class="placeholder-text">No attendance sessions recorded yet.</p>`;
    } else {
      attRecentList.innerHTML = recent.map((s) => {
        const timeText = s.createdAt.toDate().toLocaleString();
        const statusLabel = s.active ? "🟢 Active" : "Ended";
        const statusClass = s.active ? "active" : "ended";
        return `
          <div class="history-item">
            <div class="history-item-info">
              <h4>${escapeHtml(s.courseName)}</h4>
              <p>${escapeHtml(s.lecturerName || "Unknown lecturer")} · ${s.checkInCount || 0} present · ${timeText}</p>
            </div>
            <span class="history-badge ${statusClass}">${statusLabel}</span>
          </div>
        `;
      }).join("");
    }

  } catch (error) {
    console.error("Error loading attendance section:", error);
    attRecentList.innerHTML = `<p class="placeholder-text">Couldn't load attendance data right now.</p>`;
  }
}

// ============================================================
// ANALYTICS
// ============================================================
let chartsInitialized = false;

function initAnalyticsCharts() {
  if (chartsInitialized) return;
  if (typeof Chart === "undefined") {
    console.error("Chart.js failed to load — check your network connection.");
    return;
  }
  chartsInitialized = true;

  const isDark = document.body.classList.contains("dark");
  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
  const textColor = isDark ? "#b3b6cc" : "#5a5a72";

  // ---- School growth: schools added per month (last 6 months) ----
  const now = new Date();
  const monthBuckets = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthBuckets.push({ label: d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }), year: d.getFullYear(), month: d.getMonth(), count: 0 });
  }
  allSchoolsCache.forEach((s) => {
    if (!s.createdAt || !s.createdAt.toDate) return;
    const d = s.createdAt.toDate();
    const bucket = monthBuckets.find((b) => b.year === d.getFullYear() && b.month === d.getMonth());
    if (bucket) bucket.count++;
  });

  new Chart(document.getElementById("schoolGrowthChart"), {
    type: "line",
    data: {
      labels: monthBuckets.map((b) => b.label),
      datasets: [{
        label: "Schools added",
        data: monthBuckets.map((b) => b.count),
        borderColor: "#2f6fed",
        backgroundColor: "rgba(47,111,237,0.15)",
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: textColor } },
        y: { grid: { color: gridColor }, ticks: { color: textColor, precision: 0 }, beginAtZero: true }
      }
    }
  });

  // ---- Attendance trend: sessions per day, last 14 days ----
  const dayBuckets = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    dayBuckets.push({ label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), dateStr: d.toDateString(), count: 0 });
  }
  allSessionsCache.forEach((s) => {
    if (!s.createdAt || !s.createdAt.toDate) return;
    const dateStr = s.createdAt.toDate().toDateString();
    const bucket = dayBuckets.find((b) => b.dateStr === dateStr);
    if (bucket) bucket.count++;
  });

  new Chart(document.getElementById("attendanceTrendChart"), {
    type: "bar",
    data: {
      labels: dayBuckets.map((b) => b.label),
      datasets: [{
        label: "Sessions",
        data: dayBuckets.map((b) => b.count),
        backgroundColor: "#16a34a"
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: textColor } },
        y: { grid: { color: gridColor }, ticks: { color: textColor, precision: 0 }, beginAtZero: true }
      }
    }
  });

  // ---- User registration breakdown ----
  new Chart(document.getElementById("userBreakdownChart"), {
    type: "doughnut",
    data: {
      labels: ["School Admins", "Lecturers", "Students"],
      datasets: [{
        data: [allAdminsCache.length, allLecturersCache.length, allStudentsCache.length],
        backgroundColor: ["#ca8a04", "#16a34a", "#e11d48"]
      }]
    },
    options: {
      plugins: { legend: { position: "bottom", labels: { color: textColor } } }
    }
  });
}

// ============================================================
// SECURITY
// ============================================================
async function loadSecuritySection() {
  // Blocked/disabled accounts across admins, lecturers, students
  const blocked = [
    ...allAdminsCache.filter((a) => a.status === "disabled").map((a) => ({ ...a, roleLabel: "School Admin" })),
    ...allLecturersCache.filter((l) => l.status === "disabled").map((l) => ({ ...l, roleLabel: "Lecturer" })),
    ...allStudentsCache.filter((s) => s.status === "disabled").map((s) => ({ ...s, roleLabel: "Student" }))
  ];

  if (blocked.length === 0) {
    blockedAccountsList.innerHTML = `<p class="placeholder-text">No disabled accounts right now.</p>`;
  } else {
    blockedAccountsList.innerHTML = blocked.map((u) => `
      <div class="history-item">
        <div class="history-item-info">
          <h4>${escapeHtml(u.fullName || u.email || "Unknown")}</h4>
          <p>${escapeHtml(u.email || "")}</p>
          <p class="secondary-line">${u.roleLabel} · ${escapeHtml(u.schoolName || "")}</p>
        </div>
        <button class="small-btn reactivate-btn" data-user-id="${u.id}" type="button">✅ Reactivate</button>
      </div>
    `).join("");

    document.querySelectorAll(".reactivate-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const userId = btn.getAttribute("data-user-id");
        try {
          await updateDoc(doc(db, "users", userId), { status: "active" });
          await loadOverview();
          loadSecuritySection();
        } catch (error) {
          console.error("Error reactivating account:", error);
          alert("Could not reactivate this account. Please try again.");
        }
      });
    });
  }

  // Suspicious activity heuristic: schools with an unusually high number
  // of sessions created in the last 24 hours. This is a simple flag,
  // not a verified security finding — framed that way in the UI.
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  const sessionsLast24h = {};
  allSessionsCache.forEach((s) => {
    if (!s.createdAt || !s.createdAt.toDate) return;
    if (s.createdAt.toDate().getTime() < oneDayAgo) return;
    sessionsLast24h[s.schoolId] = (sessionsLast24h[s.schoolId] || 0) + 1;
  });

  const THRESHOLD = 30; // sessions/day flagged as worth a look
  const flagged = Object.entries(sessionsLast24h)
    .filter(([, count]) => count >= THRESHOLD)
    .sort((a, b) => b[1] - a[1]);

  if (flagged.length === 0) {
    suspiciousActivityList.innerHTML = `<p class="placeholder-text">Nothing flagged in the last 24 hours.</p>`;
  } else {
    suspiciousActivityList.innerHTML = flagged.map(([schoolId, count]) => {
      const school = allSchoolsCache.find((s) => s.id === schoolId);
      return `
        <div class="history-item">
          <div class="history-item-info">
            <h4>${escapeHtml(school ? school.schoolName : "Unknown school")}</h4>
            <p>${count} attendance sessions created in the last 24 hours</p>
          </div>
          <span class="history-badge suspended">Review</span>
        </div>
      `;
    }).join("");
  }
}

forceLogoutBtn.addEventListener("click", async () => {
  const email = forceLogoutEmailInput.value.trim();

  if (!email) {
    forceLogoutMessage.textContent = "Please enter an email address.";
    forceLogoutMessage.className = "form-message error";
    return;
  }

  forceLogoutBtn.disabled = true;
  forceLogoutBtn.textContent = "Working...";

  try {
    const usersQuery = query(collection(db, "users"), where("email", "==", email), limit(1));
    const snapshot = await getDocs(usersQuery);

    if (snapshot.empty) {
      forceLogoutMessage.textContent = "No account found with that email.";
      forceLogoutMessage.className = "form-message error";
    } else {
      const userDoc = snapshot.docs[0];
      if (userDoc.data().role === "superadmin") {
        forceLogoutMessage.textContent = "You can't disable a Super Admin account this way.";
        forceLogoutMessage.className = "form-message error";
      } else {
        await updateDoc(doc(db, "users", userDoc.id), { status: "disabled" });
        forceLogoutMessage.textContent = `${email} has been disabled and blocked from logging back in.`;
        forceLogoutMessage.className = "form-message success";
        forceLogoutEmailInput.value = "";
        await loadOverview();
        loadSecuritySection();
      }
    }
  } catch (error) {
    console.error("Error forcing logout:", error);
    forceLogoutMessage.textContent = "Couldn't process this right now. Please try again.";
    forceLogoutMessage.className = "form-message error";
  }

  forceLogoutBtn.disabled = false;
  forceLogoutBtn.textContent = "Disable & Force Logout";
});

// ==========================
// SIDEBAR TAB SWITCHING (lazy-loads section data on first visit)
// ==========================
const navItems = document.querySelectorAll(".nav-item");
const sections = document.querySelectorAll(".dashboard-section");
const sectionsAlreadyLoaded = new Set(["overview"]);

navItems.forEach((item) => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    const targetSection = item.getAttribute("data-section");

    navItems.forEach((nav) => nav.classList.remove("active"));
    item.classList.add("active");

    sections.forEach((section) => {
      section.classList.toggle("active", section.id === targetSection);
    });

    if (!sectionsAlreadyLoaded.has(targetSection)) {
      sectionsAlreadyLoaded.add(targetSection);
      if (targetSection === "analytics") initAnalyticsCharts();
      if (targetSection === "security") loadSecuritySection();
    }
  });
});
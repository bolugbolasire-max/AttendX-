// school-admin-dashboard.js
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
  collection,
  getDocs,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { initSessionLock } from "./session-lock.js";

// Cap on how many rows we render in one go, so a school with a large
// roster doesn't stall the page or download an oversized payload.
const LIST_DISPLAY_LIMIT = 300;

const loadingScreen = document.getElementById("loadingScreen");
const dashboardContent = document.getElementById("dashboardContent");
const welcomeMessage = document.getElementById("welcomeMessage");
const schoolNameLine = document.getElementById("schoolNameLine");
const userEmail = document.getElementById("userEmail");
const logoutBtn = document.getElementById("logoutBtn");

const lecturerCountEl = document.getElementById("lecturerCount");
const courseCountEl = document.getElementById("courseCount");
const sessionCountEl = document.getElementById("sessionCount");
const pendingRequestCountEl = document.getElementById("pendingRequestCount");

// Lecturer elements
const lecturerFullName = document.getElementById("lecturerFullName");
const lecturerEmail = document.getElementById("lecturerEmail");
const lecturerDepartment = document.getElementById("lecturerDepartment");
const lecturerStaffId = document.getElementById("lecturerStaffId");
const lecturerPassword = document.getElementById("lecturerPassword");
const lecturerFormMessage = document.getElementById("lecturerFormMessage");
const createLecturerBtn = document.getElementById("createLecturerBtn");
const lecturersList = document.getElementById("lecturersList");
const lecturerSearchInput = document.getElementById("lecturerSearchInput");
const lecturerStatusFilter = document.getElementById("lecturerStatusFilter");

// Edit lecturer modal elements
const editLecturerModal = document.getElementById("editLecturerModal");
const editLecturerId = document.getElementById("editLecturerId");
const editLecturerFullName = document.getElementById("editLecturerFullName");
const editLecturerDepartment = document.getElementById("editLecturerDepartment");
const editLecturerStaffId = document.getElementById("editLecturerStaffId");
const editLecturerCourseList = document.getElementById("editLecturerCourseList");
const editLecturerMessage = document.getElementById("editLecturerMessage");
const closeEditModalBtn = document.getElementById("closeEditModalBtn");
const cancelEditModalBtn = document.getElementById("cancelEditModalBtn");
const saveLecturerEditBtn = document.getElementById("saveLecturerEditBtn");

// Reset password modal elements
const resetPasswordModal = document.getElementById("resetPasswordModal");
const resetPasswordEmailLine = document.getElementById("resetPasswordEmailLine");
const resetPasswordMessage = document.getElementById("resetPasswordMessage");
const closeResetModalBtn = document.getElementById("closeResetModalBtn");
const cancelResetModalBtn = document.getElementById("cancelResetModalBtn");
const sendResetEmailBtn = document.getElementById("sendResetEmailBtn");

// In-memory cache of the last loaded lecturers/courses, so search and
// status filtering can run instantly without re-hitting Firestore.
let allLecturersCache = [];
let allCoursesCache = [];
let resetPasswordTargetEmail = null;

// Bulk upload elements
const lecturerCsvInput = document.getElementById("lecturerCsvInput");
const uploadCsvBtn = document.getElementById("uploadCsvBtn");
const bulkUploadMessage = document.getElementById("bulkUploadMessage");
const bulkResultsContainer = document.getElementById("bulkResultsContainer");

// Course elements
const courseNameInput = document.getElementById("courseNameInput");
const courseCodeInput = document.getElementById("courseCodeInput");
const courseDepartmentInput = document.getElementById("courseDepartmentInput");
const courseUnitInput = document.getElementById("courseUnitInput");
const courseLevelInput = document.getElementById("courseLevelInput");
const courseSemesterInput = document.getElementById("courseSemesterInput");
const courseCsvInput = document.getElementById("courseCsvInput");
const uploadCourseCsvBtn = document.getElementById("uploadCourseCsvBtn");
const courseBulkUploadMessage = document.getElementById("courseBulkUploadMessage");
const courseBulkResultsContainer = document.getElementById("courseBulkResultsContainer");
const courseFormMessage = document.getElementById("courseFormMessage");
const addCourseBtn = document.getElementById("addCourseBtn");
const coursesList = document.getElementById("coursesList");
const courseRequestsList = document.getElementById("courseRequestsList");

let currentAdmin = null; // { uid, schoolId, schoolName }

// ==========================
// AUTH GUARD
// ==========================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "school-admin-login.html";
    return;
  }

  try {
    const userDocRef = doc(db, "users", user.uid);
    const userDocSnap = await getDoc(userDocRef);

    if (!userDocSnap.exists() || userDocSnap.data().role !== "schooladmin") {
      window.location.href = "school-admin-login.html";
      return;
    }

    const userData = userDocSnap.data();

    if (!userData.schoolId) {
      // Shouldn't happen for a properly-created school admin, but guard anyway
      welcomeMessage.textContent = "No school assigned to this account.";
      loadingScreen.style.display = "none";
      dashboardContent.style.display = "flex";
      return;
    }

    // Check the school's status BEFORE rendering anything further. This
    // runs before the dashboard is revealed, so a school admin whose
    // school was already suspended never sees any dashboard content —
    // the live listener further below only handles suspension happening
    // DURING an active session.
    const schoolCheckSnap = await getDoc(doc(db, "schools", userData.schoolId));
    if (schoolCheckSnap.exists() && schoolCheckSnap.data().status === "suspended") {
      window.location.href = "school-suspended.html";
      return;
    }

    currentAdmin = {
      uid: user.uid,
      schoolId: userData.schoolId,
      schoolName: userData.schoolName || ""
    };

    welcomeMessage.textContent = `Welcome, ${userData.fullName || "School Admin"}`;
    schoolNameLine.textContent = userData.schoolName || "School Admin";
    userEmail.textContent = userData.email || user.email;

    loadingScreen.style.display = "none";
    dashboardContent.style.display = "flex";

    // Start the inactivity lock/logout system for this session.
    initSessionLock({
      uid: user.uid,
      email: userData.email || user.email,
      role: userData.role,
      loginPage: "school-admin-login.html"
    });

    // Live-watch this admin's own school for suspension. If a Super
    // Admin suspends the school while this admin is actively using the
    // dashboard, this kicks them out immediately rather than waiting
    // for their next login.
    onSnapshot(doc(db, "schools", currentAdmin.schoolId), (schoolSnap) => {
      if (schoolSnap.exists() && schoolSnap.data().status === "suspended") {
        signOut(auth).then(() => {
          window.location.href = "school-suspended.html";
        });
      }
    });

    loadLecturers();
    loadCourses();
    loadCourseRequests();
    loadStats();

  } catch (error) {
    console.error("Error loading dashboard:", error);
    window.location.href = "school-admin-login.html";
  }
});

// ==========================
// LOGOUT
// ==========================
logoutBtn.addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.href = "school-admin-login.html";
  } catch (error) {
    console.error("Error signing out:", error);
  }
});

// ==========================
// STATS
// ==========================
async function loadStats() {
  if (!currentAdmin) return;

  try {
    const lecturersQuery = query(
      collection(db, "users"),
      where("role", "==", "lecturer"),
      where("schoolId", "==", currentAdmin.schoolId)
    );
    const lecturersSnap = await getDocs(lecturersQuery);
    lecturerCountEl.textContent = lecturersSnap.size.toString();

    const coursesQuery = query(
      collection(db, "courses"),
      where("schoolId", "==", currentAdmin.schoolId)
    );
    const coursesSnap = await getDocs(coursesQuery);
    courseCountEl.textContent = coursesSnap.size.toString();

    const sessionsQuery = query(
      collection(db, "sessions"),
      where("schoolId", "==", currentAdmin.schoolId)
    );
    const sessionsSnap = await getDocs(sessionsQuery);
    sessionCountEl.textContent = sessionsSnap.size.toString();

    const pendingQuery = query(
      collection(db, "courseRequests"),
      where("schoolId", "==", currentAdmin.schoolId),
      where("status", "==", "pending")
    );
    const pendingSnap = await getDocs(pendingQuery);
    pendingRequestCountEl.textContent = pendingSnap.size.toString();

  } catch (error) {
    console.error("Error loading stats:", error);
  }
}

// ==========================
// CREATE SINGLE LECTURER
// ==========================
// Uses a secondary Firebase app instance so creating the account doesn't
// sign the School Admin out of their own session (same pattern the Super
// Admin dashboard uses for creating School Admins).
async function createLecturerAccount({ fullName, email, password, department, staffId, phone, faculty }) {
  const secondaryApp = initializeApp(auth.app.options, "secondary-" + Date.now() + "-" + Math.random());
  const secondaryAuth = getAuth(secondaryApp);

  const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
  const newUser = userCredential.user;

  await setDoc(doc(db, "users", newUser.uid), {
    fullName,
    email,
    department: department || "",
    staffId: staffId || "",
    phone: phone || "",
    faculty: faculty || "",
    role: "lecturer",
    status: "active",
    assignedCourses: [],
    schoolId: currentAdmin.schoolId,
    schoolName: currentAdmin.schoolName,
    createdAt: serverTimestamp()
  });

  await signOut(secondaryAuth);

  return newUser.uid;
}

function generateTempPassword() {
  // Simple readable temp password: e.g. "Attend-7f3k9q"
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let rand = "";
  for (let i = 0; i < 6; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `Attend-${rand}`;
}

createLecturerBtn.addEventListener("click", async () => {
  const fullName = lecturerFullName.value.trim();
  const email = lecturerEmail.value.trim();
  const department = lecturerDepartment.value.trim();
  const staffId = lecturerStaffId.value.trim();
  const password = lecturerPassword.value;

  if (!fullName || !email || !password) {
    lecturerFormMessage.textContent = "Please fill in name, email and password.";
    lecturerFormMessage.className = "form-message error";
    return;
  }

  if (password.length < 6) {
    lecturerFormMessage.textContent = "Password must be at least 6 characters.";
    lecturerFormMessage.className = "form-message error";
    return;
  }

  createLecturerBtn.disabled = true;
  createLecturerBtn.textContent = "Creating...";

  try {
    await createLecturerAccount({ fullName, email, password, department, staffId });

    lecturerFormMessage.textContent = "Lecturer account created successfully.";
    lecturerFormMessage.className = "form-message success";

    lecturerFullName.value = "";
    lecturerEmail.value = "";
    lecturerDepartment.value = "";
    lecturerStaffId.value = "";
    lecturerPassword.value = "";

    loadLecturers();
    loadStats();

  } catch (error) {
    console.error("Error creating lecturer:", error);
    if (error.code === "auth/email-already-in-use") {
      lecturerFormMessage.textContent = "This email is already registered.";
    } else {
      lecturerFormMessage.textContent = "Couldn't create this account right now. Please try again.";
    }
    lecturerFormMessage.className = "form-message error";
  }

  createLecturerBtn.disabled = false;
  createLecturerBtn.textContent = "Create Lecturer";
});

// ==========================
// BULK UPLOAD LECTURERS (CSV)
// ==========================
// Expects a header row containing at least: fullName, email
// Optional column: department
function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const fullNameIdx = headers.indexOf("fullname");
  const emailIdx = headers.indexOf("email");
  const departmentIdx = headers.indexOf("department");
  const staffIdIdx = headers.indexOf("staffid");
  const phoneIdx = headers.indexOf("phone");
  const facultyIdx = headers.indexOf("faculty");

  if (fullNameIdx === -1 || emailIdx === -1) {
    throw new Error('CSV must include "fullName" and "email" columns.');
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim());
    const fullName = cells[fullNameIdx] || "";
    const email = cells[emailIdx] || "";
    const department = departmentIdx !== -1 ? (cells[departmentIdx] || "") : "";
    const staffId = staffIdIdx !== -1 ? (cells[staffIdIdx] || "") : "";
    const phone = phoneIdx !== -1 ? (cells[phoneIdx] || "") : "";
    const faculty = facultyIdx !== -1 ? (cells[facultyIdx] || "") : "";

    if (fullName && email) {
      rows.push({ fullName, email, department, staffId, phone, faculty });
    }
  }

  return rows;
}

uploadCsvBtn.addEventListener("click", async () => {
  const file = lecturerCsvInput.files[0];

  if (!file) {
    bulkUploadMessage.textContent = "Please choose a CSV file first.";
    bulkUploadMessage.className = "form-message error";
    return;
  }

  bulkUploadMessage.textContent = "";
  bulkResultsContainer.innerHTML = "";
  uploadCsvBtn.disabled = true;
  uploadCsvBtn.textContent = "Reading file...";

  let rows;
  try {
    const text = await file.text();
    rows = parseCsv(text);
  } catch (error) {
    bulkUploadMessage.textContent = error.message || "Could not read CSV file.";
    bulkUploadMessage.className = "form-message error";
    uploadCsvBtn.disabled = false;
    uploadCsvBtn.textContent = "Upload & Create Accounts";
    return;
  }

  if (rows.length === 0) {
    bulkUploadMessage.textContent = "No valid rows found in the CSV.";
    bulkUploadMessage.className = "form-message error";
    uploadCsvBtn.disabled = false;
    uploadCsvBtn.textContent = "Upload & Create Accounts";
    return;
  }

  // Detect duplicate emails within the CSV itself (case-insensitive),
  // separate from duplicates that already exist in Firestore/Auth.
  const seenInFile = new Set();
  const results = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const emailKey = row.email.toLowerCase();
    uploadCsvBtn.textContent = `Creating ${i + 1} of ${rows.length}...`;

    if (seenInFile.has(emailKey)) {
      results.push({
        fullName: row.fullName,
        email: row.email,
        password: "",
        status: "Duplicate in file — skipped"
      });
      continue;
    }
    seenInFile.add(emailKey);

    const tempPassword = generateTempPassword();

    try {
      await createLecturerAccount({
        fullName: row.fullName,
        email: row.email,
        department: row.department,
        staffId: row.staffId,
        phone: row.phone,
        faculty: row.faculty,
        password: tempPassword
      });

      results.push({
        fullName: row.fullName,
        email: row.email,
        password: tempPassword,
        status: "Created"
      });

    } catch (error) {
      let reason = error.message || "Failed";
      if (error.code === "auth/email-already-in-use") {
        reason = "Email already registered";
      } else if (error.code === "auth/invalid-email") {
        reason = "Invalid email";
      }
      results.push({
        fullName: row.fullName,
        email: row.email,
        password: "",
        status: reason
      });
    }
  }

  const successCount = results.filter((r) => r.status === "Created").length;

  bulkUploadMessage.textContent = `Done: ${successCount} of ${rows.length} accounts created.`;
  bulkUploadMessage.className = successCount === rows.length ? "form-message success" : "form-message error";

  let tableHTML = `
    <table class="attendee-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Temp Password</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
  `;

  results.forEach((r) => {
    tableHTML += `
      <tr>
        <td>${r.fullName}</td>
        <td>${r.email}</td>
        <td>${r.password || "—"}</td>
        <td>${r.status}</td>
      </tr>
    `;
  });

  tableHTML += `</tbody></table>`;
  tableHTML += `<p class="request-hint" style="margin-top: 12px;">Copy the credentials above and send them to each lecturer securely. This list will not be shown again.</p>`;

  bulkResultsContainer.innerHTML = tableHTML;

  lecturerCsvInput.value = "";
  uploadCsvBtn.disabled = false;
  uploadCsvBtn.textContent = "Upload & Create Accounts";

  loadLecturers();
  loadStats();
});

// ==========================
// LOAD LECTURERS LIST
// ==========================
async function loadLecturers() {
  if (!currentAdmin) return;

  lecturersList.innerHTML = `<p class="placeholder-text">Loading lecturers...</p>`;

  try {
    const lecturersQuery = query(
      collection(db, "users"),
      where("role", "==", "lecturer"),
      where("schoolId", "==", currentAdmin.schoolId),
      limit(LIST_DISPLAY_LIMIT)
    );
    const snapshot = await getDocs(lecturersQuery);

    allLecturersCache = [];
    snapshot.forEach((docSnap) => {
      allLecturersCache.push({ id: docSnap.id, ...docSnap.data() });
    });

    renderLecturersList();

  } catch (error) {
    console.error("Error loading lecturers:", error);
    lecturersList.innerHTML = `<p class="placeholder-text">Couldn't load lecturers right now — check your connection and try refreshing.</p>`;
  }
}

// Renders allLecturersCache into the list, applying the current search
// text and status filter. Called after every load and on every
// search/filter input change — no Firestore round-trip needed.
function renderLecturersList() {
  const searchTerm = (lecturerSearchInput.value || "").trim().toLowerCase();
  const statusFilter = lecturerStatusFilter.value;

  let filtered = allLecturersCache.filter((lect) => {
    const status = lect.status || "active";

    if (statusFilter && status !== statusFilter) return false;

    if (searchTerm) {
      const haystack = [
        lect.fullName,
        lect.email,
        lect.department,
        lect.staffId
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(searchTerm)) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    lecturersList.innerHTML = `<p class="placeholder-text">${allLecturersCache.length === 0 ? "No lecturers yet." : "No lecturers match your search."}</p>`;
    return;
  }

  let html = "";
  filtered.forEach((lect) => {
    const status = lect.status || "active";
    const courseCount = Array.isArray(lect.assignedCourses) ? lect.assignedCourses.length : 0;

    html += `
      <div class="history-item">
        <div class="history-item-info">
          <h4>${escapeHtml(lect.fullName)} ${lect.staffId ? `<span style="color:var(--text-light); font-weight:400;">· ${escapeHtml(lect.staffId)}</span>` : ""}</h4>
          <p>${escapeHtml(lect.email)} ${lect.department ? "· " + escapeHtml(lect.department) : ""} · ${courseCount} course${courseCount === 1 ? "" : "s"} assigned</p>
        </div>
        <div class="lecturer-row-actions">
          <span class="history-badge ${status}">${status}</span>
          <button type="button" class="edit-lecturer-btn" data-id="${lect.id}">✏️ Edit</button>
          ${status === "active"
            ? `<button type="button" class="warn toggle-status-btn" data-id="${lect.id}" data-action="disable">⏸ Disable</button>`
            : status === "disabled"
              ? `<button type="button" class="toggle-status-btn" data-id="${lect.id}" data-action="enable">▶️ Enable</button>`
              : ""
          }
          ${status !== "deleted"
            ? `<button type="button" class="reset-password-btn" data-id="${lect.id}" data-email="${escapeHtml(lect.email)}">🔑 Reset Password</button>`
            : ""
          }
          ${status !== "deleted"
            ? `<button type="button" class="danger delete-lecturer-btn" data-id="${lect.id}" data-name="${escapeHtml(lect.fullName)}">🗑 Delete</button>`
            : ""
          }
        </div>
      </div>
    `;
  });

  lecturersList.innerHTML = html;

  document.querySelectorAll(".edit-lecturer-btn").forEach((btn) => {
    btn.addEventListener("click", () => openEditLecturerModal(btn.getAttribute("data-id")));
  });

  document.querySelectorAll(".toggle-status-btn").forEach((btn) => {
    btn.addEventListener("click", () => toggleLecturerStatus(
      btn.getAttribute("data-id"),
      btn.getAttribute("data-action")
    ));
  });

  document.querySelectorAll(".reset-password-btn").forEach((btn) => {
    btn.addEventListener("click", () => openResetPasswordModal(btn.getAttribute("data-email")));
  });

  document.querySelectorAll(".delete-lecturer-btn").forEach((btn) => {
    btn.addEventListener("click", () => confirmDeleteLecturer(
      btn.getAttribute("data-id"),
      btn.getAttribute("data-name")
    ));
  });
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

lecturerSearchInput.addEventListener("input", renderLecturersList);
lecturerStatusFilter.addEventListener("change", renderLecturersList);

// ==========================
// DISABLE / ENABLE LECTURER
// ==========================
// Disabling blocks login (enforced by a status check that must be added
// to the lecturer login page — see lecturer-dashboard.js / lecturer
// login handler) while keeping the account and all historical data intact.
async function toggleLecturerStatus(lecturerId, action) {
  const newStatus = action === "disable" ? "disabled" : "active";
  const confirmMsg = action === "disable"
    ? "Disable this lecturer? They won't be able to log in until re-enabled."
    : "Re-enable this lecturer's account?";

  if (!confirm(confirmMsg)) return;

  try {
    await updateDoc(doc(db, "users", lecturerId), { status: newStatus });
    loadLecturers();
  } catch (error) {
    console.error("Error updating lecturer status:", error);
    alert("Could not update this lecturer's status. Please try again.");
  }
}

// ==========================
// DELETE LECTURER (soft delete)
// ==========================
// We deliberately do NOT delete the Firestore user document or any
// attendance/session records tied to this lecturer's uid — those stay
// intact for auditing. We mark status "deleted" (which blocks login,
// same as "disabled") and hide them from the default list view.
// Note: the Firebase Auth account itself is left dormant. Fully deleting
// an arbitrary user's Auth account requires the Admin SDK (a Cloud
// Function), which this project doesn't currently have — blocking login
// via this status field achieves the same practical outcome without one.
async function confirmDeleteLecturer(lecturerId, lecturerName) {
  const ok = confirm(
    `Delete ${lecturerName}? Their attendance records will be kept for auditing, but they will no longer be able to log in. This can be manually reversed later in Firestore if needed.`
  );
  if (!ok) return;

  try {
    await updateDoc(doc(db, "users", lecturerId), { status: "deleted" });
    loadLecturers();
    loadStats();
  } catch (error) {
    console.error("Error deleting lecturer:", error);
    alert("Could not delete this lecturer. Please try again.");
  }
}

// ==========================
// EDIT LECTURER MODAL
// ==========================
async function openEditLecturerModal(lecturerId) {
  const lect = allLecturersCache.find((l) => l.id === lecturerId);
  if (!lect) return;

  editLecturerId.value = lect.id;
  editLecturerFullName.value = lect.fullName || "";
  editLecturerDepartment.value = lect.department || "";
  editLecturerStaffId.value = lect.staffId || "";
  editLecturerMessage.textContent = "";
  editLecturerMessage.className = "form-message";

  // Load this school's courses (from cache if we have them, else fetch)
  // and render as checkboxes, pre-checking the ones already assigned.
  editLecturerCourseList.innerHTML = `<p class="placeholder-text">Loading courses...</p>`;

  if (allCoursesCache.length === 0) {
    await loadCourses();
  }

  const assigned = new Set(Array.isArray(lect.assignedCourses) ? lect.assignedCourses : []);

  if (allCoursesCache.length === 0) {
    editLecturerCourseList.innerHTML = `<p class="placeholder-text">No courses available yet. Add courses first.</p>`;
  } else {
    let html = "";
    allCoursesCache.forEach((course) => {
      const checked = assigned.has(course.id) ? "checked" : "";
      html += `
        <label>
          <input type="checkbox" class="edit-course-checkbox" value="${course.id}" ${checked}>
          ${escapeHtml(course.courseName)} ${course.courseCode ? `(${escapeHtml(course.courseCode)})` : ""}
        </label>
      `;
    });
    editLecturerCourseList.innerHTML = html;
  }

  editLecturerModal.classList.add("open");
}

function closeEditLecturerModal() {
  editLecturerModal.classList.remove("open");
}

closeEditModalBtn.addEventListener("click", closeEditLecturerModal);
cancelEditModalBtn.addEventListener("click", closeEditLecturerModal);
editLecturerModal.addEventListener("click", (e) => {
  if (e.target === editLecturerModal) closeEditLecturerModal();
});

saveLecturerEditBtn.addEventListener("click", async () => {
  const lecturerId = editLecturerId.value;
  const fullName = editLecturerFullName.value.trim();
  const department = editLecturerDepartment.value.trim();
  const staffId = editLecturerStaffId.value.trim();

  if (!fullName) {
    editLecturerMessage.textContent = "Full name is required.";
    editLecturerMessage.className = "form-message error";
    return;
  }

  const assignedCourses = Array.from(document.querySelectorAll(".edit-course-checkbox:checked"))
    .map((cb) => cb.value);

  saveLecturerEditBtn.disabled = true;
  saveLecturerEditBtn.textContent = "Saving...";

  try {
    await updateDoc(doc(db, "users", lecturerId), {
      fullName,
      department,
      staffId,
      assignedCourses
    });

    closeEditLecturerModal();
    loadLecturers();

  } catch (error) {
    console.error("Error saving lecturer edit:", error);
    editLecturerMessage.textContent = "Could not save changes. Please try again.";
    editLecturerMessage.className = "form-message error";
  }

  saveLecturerEditBtn.disabled = false;
  saveLecturerEditBtn.textContent = "Save Changes";
});

// ==========================
// RESET PASSWORD MODAL
// ==========================
// Uses Firebase Auth's standard "send password reset email" flow —
// the lecturer gets an email with a link to set a new password
// themselves. This works from the client SDK without needing a backend.
function openResetPasswordModal(email) {
  resetPasswordTargetEmail = email;
  resetPasswordEmailLine.textContent = `A password reset link will be emailed to: ${email}`;
  resetPasswordMessage.textContent = "";
  resetPasswordMessage.className = "form-message";
  resetPasswordModal.classList.add("open");
}

function closeResetPasswordModal() {
  resetPasswordModal.classList.remove("open");
  resetPasswordTargetEmail = null;
}

closeResetModalBtn.addEventListener("click", closeResetPasswordModal);
cancelResetModalBtn.addEventListener("click", closeResetPasswordModal);
resetPasswordModal.addEventListener("click", (e) => {
  if (e.target === resetPasswordModal) closeResetPasswordModal();
});

sendResetEmailBtn.addEventListener("click", async () => {
  if (!resetPasswordTargetEmail) return;

  sendResetEmailBtn.disabled = true;
  sendResetEmailBtn.textContent = "Sending...";

  try {
    await sendPasswordResetEmail(auth, resetPasswordTargetEmail);
    resetPasswordMessage.textContent = "Reset email sent successfully.";
    resetPasswordMessage.className = "form-message success";
  } catch (error) {
    console.error("Error sending reset email:", error);
    resetPasswordMessage.textContent = "Could not send reset email. Please try again.";
    resetPasswordMessage.className = "form-message error";
  }

  sendResetEmailBtn.disabled = false;
  sendResetEmailBtn.textContent = "Send Reset Email";
});


// ==========================
// ADD COURSE
// ==========================
addCourseBtn.addEventListener("click", async () => {
  const courseName = courseNameInput.value.trim();
  const courseCode = courseCodeInput.value.trim();
  const department = courseDepartmentInput.value.trim();
  const unit = courseUnitInput.value.trim();
  const level = courseLevelInput.value.trim();
  const semester = courseSemesterInput.value;

  if (!courseName) {
    courseFormMessage.textContent = "Please enter a course name.";
    courseFormMessage.className = "form-message error";
    return;
  }

  addCourseBtn.disabled = true;
  addCourseBtn.textContent = "Adding...";

  try {
    // Warn (but don't block) if this course code already exists for
    // this school — mirrors the bulk-upload duplicate check below.
    if (courseCode) {
      if (allCoursesCache.length === 0) await loadCourses();
      const existing = allCoursesCache.find(
        (c) => (c.courseCode || "").toLowerCase() === courseCode.toLowerCase()
      );
      if (existing) {
        const proceed = confirm(`Course code "${courseCode}" already exists (${existing.courseName}). Add it anyway?`);
        if (!proceed) {
          addCourseBtn.disabled = false;
          addCourseBtn.textContent = "Add Course";
          return;
        }
      }
    }

    await addDoc(collection(db, "courses"), {
      courseName,
      courseCode,
      department,
      unit: unit ? Number(unit) : null,
      level,
      semester,
      archived: false,
      schoolId: currentAdmin.schoolId,
      createdAt: serverTimestamp()
    });

    courseFormMessage.textContent = "Course added successfully.";
    courseFormMessage.className = "form-message success";

    courseNameInput.value = "";
    courseCodeInput.value = "";
    courseDepartmentInput.value = "";
    courseUnitInput.value = "";
    courseLevelInput.value = "";
    courseSemesterInput.value = "";

    loadCourses();
    loadStats();

  } catch (error) {
    console.error("Error adding course:", error);
    courseFormMessage.textContent = "Couldn't add this course right now. Please try again.";
    courseFormMessage.className = "form-message error";
  }

  addCourseBtn.disabled = false;
  addCourseBtn.textContent = "Add Course";
});

// ==========================
// BULK COURSE UPLOAD (CSV)
// ==========================
function parseCourseCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const codeIdx = headers.indexOf("coursecode");
  const titleIdx = headers.indexOf("coursetitle");
  const unitIdx = headers.indexOf("unit");
  const departmentIdx = headers.indexOf("department");
  const levelIdx = headers.indexOf("level");
  const semesterIdx = headers.indexOf("semester");

  if (codeIdx === -1 || titleIdx === -1) {
    throw new Error('CSV must include "courseCode" and "courseTitle" columns.');
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim());
    const courseCode = cells[codeIdx] || "";
    const courseName = cells[titleIdx] || "";
    const unit = unitIdx !== -1 ? (cells[unitIdx] || "") : "";
    const department = departmentIdx !== -1 ? (cells[departmentIdx] || "") : "";
    const level = levelIdx !== -1 ? (cells[levelIdx] || "") : "";
    const semester = semesterIdx !== -1 ? (cells[semesterIdx] || "") : "";

    if (courseCode && courseName) {
      rows.push({ courseCode, courseName, unit, department, level, semester });
    } else {
      // Row is missing a required field — still record it so the
      // "invalid rows" count in the summary reflects reality.
      rows.push({ courseCode, courseName, unit, department, level, semester, invalid: true });
    }
  }

  return rows;
}

courseCsvInput.addEventListener("change", () => {
  courseBulkUploadMessage.textContent = "";
  courseBulkUploadMessage.className = "form-message";
  courseBulkResultsContainer.innerHTML = "";
});

uploadCourseCsvBtn.addEventListener("click", async () => {
  const file = courseCsvInput.files[0];

  if (!file) {
    courseBulkUploadMessage.textContent = "Please choose a CSV file first.";
    courseBulkUploadMessage.className = "form-message error";
    return;
  }

  uploadCourseCsvBtn.disabled = true;
  uploadCourseCsvBtn.textContent = "Reading file...";
  courseBulkUploadMessage.textContent = "";
  courseBulkResultsContainer.innerHTML = "";

  let rows;
  try {
    const text = await file.text();
    rows = parseCourseCsv(text);
  } catch (error) {
    courseBulkUploadMessage.textContent = error.message || "Couldn't read this CSV file.";
    courseBulkUploadMessage.className = "form-message error";
    uploadCourseCsvBtn.disabled = false;
    uploadCourseCsvBtn.textContent = "Upload & Import Courses";
    return;
  }

  if (rows.length === 0) {
    courseBulkUploadMessage.textContent = "No rows found in this file.";
    courseBulkUploadMessage.className = "form-message error";
    uploadCourseCsvBtn.disabled = false;
    uploadCourseCsvBtn.textContent = "Upload & Import Courses";
    return;
  }

  // Make sure we have the current course list to check against —
  // this is how we detect "already exists" duplicates, not just
  // duplicates within the uploaded file itself.
  if (allCoursesCache.length === 0) {
    await loadCourses();
  }
  const existingCodes = new Set(
    allCoursesCache.map((c) => (c.courseCode || "").toLowerCase()).filter(Boolean)
  );

  const seenInFile = new Set();
  const results = { imported: 0, duplicates: 0, invalid: 0 };
  const duplicateRows = [];
  const invalidRows = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    uploadCourseCsvBtn.textContent = `Importing ${i + 1} of ${rows.length}...`;

    if (row.invalid) {
      results.invalid++;
      invalidRows.push(row);
      continue;
    }

    const codeKey = row.courseCode.toLowerCase();

    if (existingCodes.has(codeKey) || seenInFile.has(codeKey)) {
      results.duplicates++;
      duplicateRows.push(row);
      continue;
    }
    seenInFile.add(codeKey);

    try {
      await addDoc(collection(db, "courses"), {
        courseName: row.courseName,
        courseCode: row.courseCode,
        department: row.department,
        unit: row.unit ? Number(row.unit) : null,
        level: row.level,
        semester: row.semester,
        archived: false,
        schoolId: currentAdmin.schoolId,
        createdAt: serverTimestamp()
      });
      results.imported++;
    } catch (error) {
      console.error("Error importing course row:", error);
      results.invalid++;
      invalidRows.push(row);
    }
  }

  // Summary line, matching the "✔ 150 courses imported successfully,
  // 0 duplicates, 2 invalid rows" format from the spec.
  let summaryHtml = `
    <div class="history-item">
      <div class="history-item-info">
        <h4>✔ ${results.imported} course${results.imported === 1 ? "" : "s"} imported successfully</h4>
        <p>${results.duplicates} duplicate${results.duplicates === 1 ? "" : "s"} · ${results.invalid} invalid row${results.invalid === 1 ? "" : "s"}</p>
      </div>
    </div>
  `;

  if (duplicateRows.length > 0) {
    summaryHtml += `<p style="margin-top:14px; font-size:0.85rem; color:var(--text-light);">Duplicate rows (skipped):</p>`;
    summaryHtml += `<table class="attendee-table"><thead><tr><th>Code</th><th>Title</th></tr></thead><tbody>`;
    duplicateRows.forEach((row) => {
      summaryHtml += `<tr><td>${escapeHtml(row.courseCode)}</td><td>${escapeHtml(row.courseName)}</td></tr>`;
    });
    summaryHtml += `</tbody></table>`;
  }

  if (invalidRows.length > 0) {
    summaryHtml += `<p style="margin-top:14px; font-size:0.85rem; color:var(--text-light);">Invalid rows (missing course code or title):</p>`;
    summaryHtml += `<table class="attendee-table"><thead><tr><th>Code</th><th>Title</th></tr></thead><tbody>`;
    invalidRows.forEach((row) => {
      summaryHtml += `<tr><td>${escapeHtml(row.courseCode || "—")}</td><td>${escapeHtml(row.courseName || "—")}</td></tr>`;
    });
    summaryHtml += `</tbody></table>`;
  }

  courseBulkResultsContainer.innerHTML = summaryHtml;
  courseBulkUploadMessage.textContent = "Import complete.";
  courseBulkUploadMessage.className = "form-message success";

  courseCsvInput.value = "";
  uploadCourseCsvBtn.disabled = false;
  uploadCourseCsvBtn.textContent = "Upload & Import Courses";

  loadCourses();
  loadStats();
});

// ==========================
// LOAD COURSES
// ==========================
async function loadCourses() {
  if (!currentAdmin) return;

  coursesList.innerHTML = `<p class="placeholder-text">Loading courses...</p>`;

  try {
    const coursesQuery = query(
      collection(db, "courses"),
      where("schoolId", "==", currentAdmin.schoolId),
      limit(LIST_DISPLAY_LIMIT)
    );
    const snapshot = await getDocs(coursesQuery);

    allCoursesCache = [];
    snapshot.forEach((docSnap) => {
      allCoursesCache.push({ id: docSnap.id, ...docSnap.data() });
    });

    if (allCoursesCache.length === 0) {
      coursesList.innerHTML = `<p class="placeholder-text">No courses added yet.</p>`;
      return;
    }

    let html = "";
    allCoursesCache.forEach((course) => {
      html += `
        <div class="history-item">
          <div class="history-item-info">
            <h4>${escapeHtml(course.courseName)}</h4>
            <p>${escapeHtml(course.courseCode || "")} ${course.department ? "· " + escapeHtml(course.department) : ""}</p>
          </div>
        </div>
      `;
    });

    coursesList.innerHTML = html;

  } catch (error) {
    console.error("Error loading courses:", error);
    coursesList.innerHTML = `<p class="placeholder-text">Couldn't load courses right now — check your connection and try refreshing.</p>`;
  }
}

// ==========================
// LOAD + HANDLE COURSE REQUESTS (scoped to this school)
// ==========================
async function loadCourseRequests() {
  if (!currentAdmin) return;

  courseRequestsList.innerHTML = `<p class="placeholder-text">Loading requests...</p>`;

  try {
    const requestsQuery = query(
      collection(db, "courseRequests"),
      where("schoolId", "==", currentAdmin.schoolId),
      where("status", "==", "pending"),
      orderBy("createdAt", "desc"),
      limit(LIST_DISPLAY_LIMIT)
    );
    const snapshot = await getDocs(requestsQuery);

    if (snapshot.empty) {
      courseRequestsList.innerHTML = `<p class="placeholder-text">No pending requests.</p>`;
      return;
    }

    let html = "";
    snapshot.forEach((docSnap) => {
      const req = docSnap.data();
      html += `
        <div class="history-item" data-request-id="${docSnap.id}">
          <div class="history-item-info">
            <h4>${req.courseName}</h4>
            <p>${req.courseCode || ""} — requested by ${req.requestedByName || "a lecturer"}</p>
          </div>
          <div class="school-row-actions">
            <button class="delete-school-btn approve-request-btn" data-request-id="${docSnap.id}" type="button">✅</button>
            <button class="delete-school-btn reject-request-btn" data-request-id="${docSnap.id}" type="button">❌</button>
          </div>
        </div>
      `;
    });

    courseRequestsList.innerHTML = html;

    document.querySelectorAll(".approve-request-btn").forEach((btn) => {
      btn.addEventListener("click", () => handleCourseRequest(btn.getAttribute("data-request-id"), "approved"));
    });

    document.querySelectorAll(".reject-request-btn").forEach((btn) => {
      btn.addEventListener("click", () => handleCourseRequest(btn.getAttribute("data-request-id"), "rejected"));
    });

  } catch (error) {
    console.error("Error loading course requests:", error);
    courseRequestsList.innerHTML = `<p class="placeholder-text">Couldn't load pending requests right now — check your connection and try refreshing.</p>`;
  }
}

async function handleCourseRequest(requestId, decision) {
  try {
    const requestRef = doc(db, "courseRequests", requestId);
    const requestSnap = await getDoc(requestRef);

    if (!requestSnap.exists()) return;
    const req = requestSnap.data();

    await updateDoc(requestRef, { status: decision });

    // If approved, also add it to the courses collection so it shows up
    // in lecturers' course dropdowns right away.
    if (decision === "approved") {
      await addDoc(collection(db, "courses"), {
        courseName: req.courseName,
        courseCode: req.courseCode || "",
        department: req.department || "",
        schoolId: currentAdmin.schoolId,
        createdAt: serverTimestamp()
      });
    }

    loadCourseRequests();
    loadCourses();
    loadStats();

  } catch (error) {
    console.error("Error handling course request:", error);
    alert("Could not update this request. Please try again.");
  }
}

// ==========================
// SIDEBAR TAB SWITCHING
// ==========================
const navItems = document.querySelectorAll(".nav-item");
const sections = document.querySelectorAll(".dashboard-section");

navItems.forEach((item) => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    const targetSection = item.getAttribute("data-section");

    navItems.forEach((nav) => nav.classList.remove("active"));
    item.classList.add("active");

    sections.forEach((section) => {
      section.classList.toggle("active", section.id === targetSection);
    });
  });
});
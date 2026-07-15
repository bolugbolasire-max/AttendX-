// school-admin-dashboard.js
import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signOut,
  createUserWithEmailAndPassword
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
const lecturerPassword = document.getElementById("lecturerPassword");
const lecturerFormMessage = document.getElementById("lecturerFormMessage");
const createLecturerBtn = document.getElementById("createLecturerBtn");
const lecturersList = document.getElementById("lecturersList");

// Bulk upload elements
const lecturerCsvInput = document.getElementById("lecturerCsvInput");
const uploadCsvBtn = document.getElementById("uploadCsvBtn");
const bulkUploadMessage = document.getElementById("bulkUploadMessage");
const bulkResultsContainer = document.getElementById("bulkResultsContainer");

// Course elements
const courseNameInput = document.getElementById("courseNameInput");
const courseCodeInput = document.getElementById("courseCodeInput");
const courseDepartmentInput = document.getElementById("courseDepartmentInput");
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

    // Live-watch this admin's own school for suspension. If a Super
    // Admin suspends the school while this admin is actively using the
    // dashboard, this kicks them out immediately rather than waiting
    // for their next login.
    onSnapshot(doc(db, "schools", currentAdmin.schoolId), (schoolSnap) => {
      if (schoolSnap.exists() && schoolSnap.data().status === "suspended") {
        alert("Your school's access has been suspended. You will now be logged out.");
        signOut(auth).then(() => {
          window.location.href = "school-admin-login.html";
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
async function createLecturerAccount({ fullName, email, password, department }) {
  const secondaryApp = initializeApp(auth.app.options, "secondary-" + Date.now() + "-" + Math.random());
  const secondaryAuth = getAuth(secondaryApp);

  const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
  const newUser = userCredential.user;

  await setDoc(doc(db, "users", newUser.uid), {
    fullName,
    email,
    department: department || "",
    role: "lecturer",
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
    await createLecturerAccount({ fullName, email, password, department });

    lecturerFormMessage.textContent = "Lecturer account created successfully.";
    lecturerFormMessage.className = "form-message success";

    lecturerFullName.value = "";
    lecturerEmail.value = "";
    lecturerDepartment.value = "";
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

  if (fullNameIdx === -1 || emailIdx === -1) {
    throw new Error('CSV must include "fullName" and "email" columns.');
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim());
    const fullName = cells[fullNameIdx] || "";
    const email = cells[emailIdx] || "";
    const department = departmentIdx !== -1 ? (cells[departmentIdx] || "") : "";

    if (fullName && email) {
      rows.push({ fullName, email, department });
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

  const results = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    uploadCsvBtn.textContent = `Creating ${i + 1} of ${rows.length}...`;

    const tempPassword = generateTempPassword();

    try {
      await createLecturerAccount({
        fullName: row.fullName,
        email: row.email,
        department: row.department,
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

    if (snapshot.empty) {
      lecturersList.innerHTML = `<p class="placeholder-text">No lecturers yet.</p>`;
      return;
    }

    let html = "";
    snapshot.forEach((docSnap) => {
      const lecturer = docSnap.data();
      html += `
        <div class="history-item">
          <div class="history-item-info">
            <h4>${lecturer.fullName}</h4>
            <p>${lecturer.email} ${lecturer.department ? "· " + lecturer.department : ""}</p>
          </div>
        </div>
      `;
    });

    lecturersList.innerHTML = html;

  } catch (error) {
    console.error("Error loading lecturers:", error);
    lecturersList.innerHTML = `<p class="placeholder-text">Couldn't load lecturers right now — check your connection and try refreshing.</p>`;
  }
}

// ==========================
// ADD COURSE
// ==========================
addCourseBtn.addEventListener("click", async () => {
  const courseName = courseNameInput.value.trim();
  const courseCode = courseCodeInput.value.trim();
  const department = courseDepartmentInput.value.trim();

  if (!courseName) {
    courseFormMessage.textContent = "Please enter a course name.";
    courseFormMessage.className = "form-message error";
    return;
  }

  addCourseBtn.disabled = true;
  addCourseBtn.textContent = "Adding...";

  try {
    await addDoc(collection(db, "courses"), {
      courseName,
      courseCode,
      department,
      schoolId: currentAdmin.schoolId,
      createdAt: serverTimestamp()
    });

    courseFormMessage.textContent = "Course added successfully.";
    courseFormMessage.className = "form-message success";

    courseNameInput.value = "";
    courseCodeInput.value = "";
    courseDepartmentInput.value = "";

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

    if (snapshot.empty) {
      coursesList.innerHTML = `<p class="placeholder-text">No courses added yet.</p>`;
      return;
    }

    let html = "";
    snapshot.forEach((docSnap) => {
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
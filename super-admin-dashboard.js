// super-admin-dashboard.js
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
  collection,
  getDocs,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const loadingScreen = document.getElementById("loadingScreen");
const dashboardContent = document.getElementById("dashboardContent");
const welcomeMessage = document.getElementById("welcomeMessage");
const userEmail = document.getElementById("userEmail");
const logoutBtn = document.getElementById("logoutBtn");

const schoolCountEl = document.getElementById("schoolCount");
const activeSchoolCountEl = document.getElementById("activeSchoolCount");
const adminCountEl = document.getElementById("adminCount");

const schoolNameInput = document.getElementById("schoolNameInput");
const schoolStatusSelect = document.getElementById("schoolStatusSelect");
const schoolFormMessage = document.getElementById("schoolFormMessage");
const addSchoolBtn = document.getElementById("addSchoolBtn");
const schoolsList = document.getElementById("schoolsList");

const adminFullName = document.getElementById("adminFullName");
const adminEmail = document.getElementById("adminEmail");
const adminPassword = document.getElementById("adminPassword");
const adminSchoolSelect = document.getElementById("adminSchoolSelect");
const adminFormMessage = document.getElementById("adminFormMessage");
const createAdminBtn = document.getElementById("createAdminBtn");

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

    loadSchools();
    loadStats();

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

// ==========================
// LOAD OVERVIEW STATS
// ==========================
async function loadStats() {
  try {
    const schoolsSnapshot = await getDocs(collection(db, "schools"));
    schoolCountEl.textContent = schoolsSnapshot.size.toString();

    let activeCount = 0;
    schoolsSnapshot.forEach((docSnap) => {
      if (docSnap.data().status === "active") activeCount++;
    });
    activeSchoolCountEl.textContent = activeCount.toString();

    const adminsQuery = query(collection(db, "users"), where("role", "==", "schooladmin"));
    const adminsSnapshot = await getDocs(adminsQuery);
    adminCountEl.textContent = adminsSnapshot.size.toString();

  } catch (error) {
    console.error("Error loading stats:", error);
  }
}

// ==========================
// ADD A NEW SCHOOL
// ==========================
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

    loadSchools();
    loadStats();

  } catch (error) {
    console.error("Error adding school:", error);
    schoolFormMessage.textContent = `Error: ${error.message || error}`;
    schoolFormMessage.className = "form-message error";
  }

  addSchoolBtn.disabled = false;
  addSchoolBtn.textContent = "Add School";
});

// ==========================
// LOAD SCHOOLS (list + dropdown for admin assignment)
// ==========================
async function loadSchools() {
  try {
    const snapshot = await getDocs(collection(db, "schools"));

    if (snapshot.empty) {
      schoolsList.innerHTML = `<p class="placeholder-text">No schools added yet.</p>`;
      adminSchoolSelect.innerHTML = `<option value="">No schools available</option>`;
      return;
    }

    let listHTML = "";
    adminSchoolSelect.innerHTML = `<option value="">Choose a school...</option>`;

    snapshot.forEach((docSnap) => {
      const school = docSnap.data();

      listHTML += `
        <div class="history-item">
          <div class="history-item-info">
            <h4>${school.schoolName}</h4>
          </div>
          <span class="history-badge ${school.status === 'active' ? 'active' : school.status === 'suspended' ? 'rejected' : 'pending'}">${school.status}</span>
        </div>
      `;

      const option = document.createElement("option");
      option.value = docSnap.id;
      option.textContent = school.schoolName;
      adminSchoolSelect.appendChild(option);
    });

    schoolsList.innerHTML = listHTML;

  } catch (error) {
    console.error("Error loading schools:", error);
    schoolsList.innerHTML = `<p class="placeholder-text">Error: ${error.message || error}</p>`;
  }
}

// ==========================
// CREATE SCHOOL ADMIN ACCOUNT
// ==========================
// We use a SEPARATE, temporary Firebase app instance for this. Creating a
// user normally signs Firebase Auth in as that new user in the current
// session, which would kick the Super Admin out. A secondary app instance
// keeps the Super Admin's own session untouched.
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

  // Get the school name for storing alongside the schoolId
  const schoolName = adminSchoolSelect.options[adminSchoolSelect.selectedIndex].textContent;

  let secondaryApp;
  try {
    // Create a temporary secondary app instance so this doesn't disturb
    // the Super Admin's own logged-in session.
    secondaryApp = initializeApp(auth.app.options, "secondary-" + Date.now());
    const secondaryAuth = getAuth(secondaryApp);

    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const newUser = userCredential.user;

    await setDoc(doc(db, "users", newUser.uid), {
      fullName,
      email,
      role: "schooladmin",
      schoolId,
      schoolName,
      createdAt: serverTimestamp()
    });

    // Sign out of the secondary instance (doesn't affect the main session)
    await signOut(secondaryAuth);

    adminFormMessage.textContent = "School Admin account created successfully.";
    adminFormMessage.className = "form-message success";

    adminFullName.value = "";
    adminEmail.value = "";
    adminPassword.value = "";
    adminSchoolSelect.value = "";

    loadStats();

  } catch (error) {
    console.error("Error creating school admin:", error);

    if (error.code === "auth/email-already-in-use") {
      adminFormMessage.textContent = "This email is already registered.";
    } else {
      adminFormMessage.textContent = `Error: ${error.message || error}`;
    }
    adminFormMessage.className = "form-message error";
  }

  createAdminBtn.disabled = false;
  createAdminBtn.textContent = "Create School Admin";
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

    navItems.forEach((nav) => nav.classList.remove("active"));
    item.classList.add("active");

    sections.forEach((section) => {
      section.classList.toggle("active", section.id === targetSection);
    });
  });
});
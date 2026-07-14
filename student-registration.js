// student-registration.js
import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  setDoc,
  collection,
  getDocs,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const registerForm = document.getElementById("registerForm");
const registerBtn = document.getElementById("registerBtn");
const formMessage = document.getElementById("formMessage");
const schoolSelect = document.getElementById("schoolSelect");

function showMessage(text, type) {
  formMessage.textContent = text;
  formMessage.className = `form-message ${type}`;
}

// ==========================
// LOAD ACTIVE SCHOOLS INTO DROPDOWN
// ==========================
async function loadSchools() {
  try {
    const schoolsQuery = query(
      collection(db, "schools"),
      where("status", "==", "active")
    );
    const snapshot = await getDocs(schoolsQuery);

    if (snapshot.empty) {
      schoolSelect.innerHTML = `<option value="">No schools available yet</option>`;
      return;
    }

    schoolSelect.innerHTML = `<option value="">Select your school...</option>`;

    snapshot.forEach((docSnap) => {
      const school = docSnap.data();
      const option = document.createElement("option");
      option.value = docSnap.id;
      option.textContent = school.schoolName;
      option.dataset.schoolName = school.schoolName;
      schoolSelect.appendChild(option);
    });

  } catch (error) {
    console.error("Error loading schools:", error);
    schoolSelect.innerHTML = `<option value="">Could not load schools</option>`;
  }
}

loadSchools();

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const fullName = document.getElementById("fullName").value.trim();
  const matricNumber = document.getElementById("matricNumber").value.trim();
  const schoolId = schoolSelect.value;
  const schoolName = schoolId ? schoolSelect.options[schoolSelect.selectedIndex].textContent : "";
  const department = document.getElementById("department").value.trim();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  showMessage("", "");

  if (!schoolId) {
    showMessage("Please select your school.", "error");
    return;
  }

  registerBtn.disabled = true;
  registerBtn.textContent = "Creating account...";

  try {
    // 1. Create the login credentials in Firebase Auth
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // 2. Save the extra profile info in Firestore, linked by the same UID
    await setDoc(doc(db, "users", user.uid), {
      fullName,
      matricNumber,
      schoolId,
      schoolName,
      department,
      email,
      role: "student",
      createdAt: serverTimestamp()
    });

    showMessage("Account created! Redirecting to login...", "success");

    setTimeout(() => {
      window.location.href = "student-login.html";
    }, 1500);

  } catch (error) {
    console.error(error);

    if (error.code === "auth/email-already-in-use") {
      showMessage("This email is already registered. Try logging in instead.", "error");
    } else if (error.code === "auth/invalid-email") {
      showMessage("Please enter a valid email address.", "error");
    } else if (error.code === "auth/weak-password") {
      showMessage("Password should be at least 6 characters.", "error");
    } else {
      showMessage("Something went wrong. Please try again.", "error");
    }

    registerBtn.disabled = false;
    registerBtn.textContent = "Create Account";
  }
});
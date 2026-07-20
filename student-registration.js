// student-registration.js
import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut
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

  // Explicit guard for all required fields — the `required` HTML
  // attributes should stop empty submissions, but this is a backstop
  // in case that validation gets bypassed (autofill quirks, browser
  // differences, programmatic submits, etc). Without this, a blank
  // email could reach Firebase and produce a confusing result.
  if (!fullName || !matricNumber || !department || !email || !password) {
    showMessage("Please fill in all fields before submitting.", "error");
    return;
  }

  if (!schoolId) {
    showMessage("Please select your school.", "error");
    return;
  }

  if (password.length < 6) {
    showMessage("Password should be at least 6 characters.", "error");
    return;
  }

  // Require the reCAPTCHA checkbox to be completed before attempting
  // account creation. This is a frontend-only check (no server-side
  // secret-key verification, since AttendX has no backend) — it stops
  // casual bots and scripted mass-signups, but isn't a guarantee
  // against a determined attacker inspecting the client code. Checked
  // last among the validation guards so a student filling the form out
  // normally sees field-specific errors first, and only sees the
  // reCAPTCHA prompt once everything else is actually filled in.
  const recaptchaResponse = grecaptcha.getResponse();
  if (!recaptchaResponse) {
    showMessage("Please complete the reCAPTCHA before submitting.", "error");
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

    // 3. Send a verification email — students must confirm their address
    // before they're allowed to log in (see student-login.js).
    try {
      await sendEmailVerification(user);
    } catch (verifyError) {
      // Account + profile were still created successfully; verification
      // email sending is a secondary step, so don't block on it — but
      // do log it in case it needs investigating.
      console.error("Error sending verification email:", verifyError);
    }

    // 4. Sign the new user back out immediately. They're not allowed to
    // use the dashboard until they've verified their email, so there's
    // no reason to leave an active (unverified) session live.
    await signOut(auth);

    showMessage(
      "Account created! We've sent a verification link to your email — please verify before logging in. Check your spam/junk folder if you don't see it within a few minutes.",
      "success"
    );

    setTimeout(() => {
      window.location.href = "student-login.html";
    }, 2200);

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

    grecaptcha.reset();
    registerBtn.disabled = false;
    registerBtn.textContent = "Create Account";
  }
});
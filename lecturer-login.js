// lecturer-login.js
import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const loginForm = document.getElementById("loginForm");
const loginBtn = document.getElementById("loginBtn");
const formMessage = document.getElementById("formMessage");

function showMessage(text, type) {
  formMessage.textContent = text;
  formMessage.className = `form-message ${type}`;
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  // Require the reCAPTCHA checkbox to be completed before attempting
  // sign-in. This is a frontend-only check (no server-side secret-key
  // verification, since AttendX has no backend) — it stops casual bots
  // and scripted submissions, but isn't a guarantee against a
  // determined attacker inspecting the client code.
  const recaptchaResponse = grecaptcha.getResponse();
  if (!recaptchaResponse) {
    showMessage("Please complete the reCAPTCHA before logging in.", "error");
    return;
  }

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  showMessage("", "");
  loginBtn.disabled = true;
  loginBtn.textContent = "Logging in...";

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    const userDocRef = doc(db, "users", user.uid);
    const userDocSnap = await getDoc(userDocRef);

    if (!userDocSnap.exists()) {
      showMessage("No profile found for this account. Contact your school admin.", "error");
      grecaptcha.reset();
      loginBtn.disabled = false;
      loginBtn.textContent = "Login";
      return;
    }

    const userData = userDocSnap.data();

    if (userData.role !== "lecturer") {
      showMessage("This account is not registered as a lecturer.", "error");
      grecaptcha.reset();
      loginBtn.disabled = false;
      loginBtn.textContent = "Login";
      return;
    }

    // Block login for lecturers who have been disabled or deleted by
    // their School Admin. Their account and Firestore doc still exist
    // (so attendance history stays intact) — this just gates the login.
    if (userData.status === "disabled") {
      await signOut(auth);
      showMessage("Your account has been disabled. Please contact your School Admin.", "error");
      grecaptcha.reset();
      loginBtn.disabled = false;
      loginBtn.textContent = "Login";
      return;
    }

    if (userData.status === "deleted") {
      await signOut(auth);
      showMessage("This account is no longer active. Please contact your School Admin.", "error");
      grecaptcha.reset();
      loginBtn.disabled = false;
      loginBtn.textContent = "Login";
      return;
    }

    // Block login if the lecturer's school has been suspended by the
    // Super Admin. We sign them back out so no dashboard-eligible
    // session is left active.
    if (userData.schoolId) {
      const schoolDocSnap = await getDoc(doc(db, "schools", userData.schoolId));
      if (schoolDocSnap.exists() && schoolDocSnap.data().status === "suspended") {
        await signOut(auth);
        showMessage("Your school's access has been suspended. Please contact your School Admin.", "error");
        grecaptcha.reset();
        loginBtn.disabled = false;
        loginBtn.textContent = "Login";
        return;
      }
    }

    showMessage("Login successful! Redirecting...", "success");

    setTimeout(() => {
      window.location.href = "lecturer-dashboard.html";
    }, 1200);

  } catch (error) {
    console.error(error);

    if (error.code === "auth/invalid-credential" || error.code === "auth/wrong-password") {
      showMessage("Incorrect email or password.", "error");
    } else if (error.code === "auth/user-not-found") {
      showMessage("No account found with this email.", "error");
    } else if (error.code === "auth/invalid-email") {
      showMessage("Please enter a valid email address.", "error");
    } else if (error.code === "auth/too-many-requests") {
      showMessage("Too many attempts. Please try again later.", "error");
    } else {
      showMessage("Something went wrong. Please try again.", "error");
    }

    grecaptcha.reset();
    loginBtn.disabled = false;
    loginBtn.textContent = "Login";
  }
});
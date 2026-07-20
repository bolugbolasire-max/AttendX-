// super-admin-login.js
import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword
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
      showMessage("No profile found for this account.", "error");
      grecaptcha.reset();
      loginBtn.disabled = false;
      loginBtn.textContent = "Login";
      return;
    }

    const userData = userDocSnap.data();

    if (userData.role !== "superadmin") {
      showMessage("This account is not authorized as Super Admin.", "error");
      grecaptcha.reset();
      loginBtn.disabled = false;
      loginBtn.textContent = "Login";
      return;
    }

    showMessage("Login successful! Redirecting...", "success");

    setTimeout(() => {
      window.location.href = "super-admin-dashboard.html";
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
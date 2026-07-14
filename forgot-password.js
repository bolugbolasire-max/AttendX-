// forgot-password.js
import { auth } from "./firebase-config.js";
import {
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const resetForm = document.getElementById("resetForm");
const resetBtn = document.getElementById("resetBtn");
const formMessage = document.getElementById("formMessage");

function showMessage(text, type) {
  formMessage.textContent = text;
  formMessage.className = `form-message ${type}`;
}

resetForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("email").value.trim();

  showMessage("", "");

  // Guard against empty/blank submissions reaching Firebase at all — the
  // input has `required`, but this is a backstop in case that validation
  // gets bypassed (autofill quirks, programmatic submits, etc).
  if (!email) {
    showMessage("Please enter your email address.", "error");
    return;
  }

  resetBtn.disabled = true;
  resetBtn.textContent = "Sending...";

  try {
    await sendPasswordResetEmail(auth, email);

    // Deliberately show the same success message whether or not the email
    // exists, so this page can't be used to check which emails are registered.
    showMessage("If an account exists for that email, a reset link has been sent. Check your spam/junk folder if it doesn't arrive within a few minutes.", "success");
    resetForm.reset();

  } catch (error) {
    console.error(error);

    if (error.code === "auth/user-not-found") {
      // This is the one case we intentionally mask — showing the same
      // neutral success message prevents this page being used to check
      // which emails are registered.
      showMessage("If an account exists for that email, a reset link has been sent. Check your spam/junk folder if it doesn't arrive within a few minutes.", "success");
      resetForm.reset();
    } else if (error.code === "auth/invalid-email") {
      showMessage("Please enter a valid email address.", "error");
    } else if (error.code === "auth/too-many-requests") {
      showMessage("Too many attempts. Please try again later.", "error");
    } else if (error.code === "auth/network-request-failed") {
      showMessage("Network error — please check your connection and try again.", "error");
    } else {
      // Any other real error (misconfiguration, Firebase outage, etc.)
      // should be visible, not silently reported as success.
      showMessage("Something went wrong. Please try again shortly.", "error");
    }
  }

  resetBtn.disabled = false;
  resetBtn.textContent = "Send Reset Link";
});
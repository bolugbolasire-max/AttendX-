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
  resetBtn.disabled = true;
  resetBtn.textContent = "Sending...";

  try {
    await sendPasswordResetEmail(auth, email);

    // Deliberately show the same success message whether or not the email
    // exists, so this page can't be used to check which emails are registered.
    showMessage("If an account exists for that email, a reset link has been sent.", "success");
    resetForm.reset();

  } catch (error) {
    console.error(error);

    if (error.code === "auth/invalid-email") {
      showMessage("Please enter a valid email address.", "error");
    } else if (error.code === "auth/too-many-requests") {
      showMessage("Too many attempts. Please try again later.", "error");
    } else {
      // Same neutral message for user-not-found and anything else,
      // to avoid revealing whether an email is registered.
      showMessage("If an account exists for that email, a reset link has been sent.", "success");
    }
  }

  resetBtn.disabled = false;
  resetBtn.textContent = "Send Reset Link";
});
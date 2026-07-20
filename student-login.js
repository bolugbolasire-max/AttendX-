// student-login.js
import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  sendEmailVerification,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const loginForm = document.getElementById("loginForm");
const loginBtn = document.getElementById("loginBtn");
const formMessage = document.getElementById("formMessage");

// Kept so a "resend verification email" link can re-send without asking
// the student to type their password again.
let pendingUnverifiedUser = null;

function showMessage(text, type) {
  formMessage.textContent = text;
  formMessage.className = `form-message ${type}`;
}

function showUnverifiedMessage() {
  formMessage.innerHTML =
    'Please verify your email before logging in. Check your inbox (and spam/junk folder) for the link, or ' +
    '<a href="#" id="resendVerificationLink">resend the verification email</a>.';
  formMessage.className = "form-message error";

  const resendLink = document.getElementById("resendVerificationLink");
  if (resendLink) {
    resendLink.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!pendingUnverifiedUser) return;

      resendLink.textContent = "Sending...";
      try {
        await sendEmailVerification(pendingUnverifiedUser);
        resendLink.textContent = "Sent! Check your inbox.";
      } catch (error) {
        console.error("Error resending verification email:", error);
        resendLink.textContent = "Could not resend — try again shortly.";
      }
    });
  }
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

    // Block unverified students from proceeding. We sign them back out
    // immediately so no dashboard-eligible session is left active.
    if (!user.emailVerified) {
      pendingUnverifiedUser = user;
      await signOut(auth);
      showUnverifiedMessage();
      grecaptcha.reset();
      loginBtn.disabled = false;
      loginBtn.textContent = "Login";
      return;
    }

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

    if (userData.role !== "student") {
      showMessage("This account is not registered as a student.", "error");
      grecaptcha.reset();
      loginBtn.disabled = false;
      loginBtn.textContent = "Login";
      return;
    }

    // Block login if the student's school has been suspended by the
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
      window.location.href = "student-dashboard.html";
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
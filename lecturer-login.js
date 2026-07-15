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
      loginBtn.disabled = false;
      loginBtn.textContent = "Login";
      return;
    }

    const userData = userDocSnap.data();

    if (userData.role !== "lecturer") {
      showMessage("This account is not registered as a lecturer.", "error");
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

    loginBtn.disabled = false;
    loginBtn.textContent = "Login";
  }
});
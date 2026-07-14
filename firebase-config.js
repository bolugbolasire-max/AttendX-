// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDHXIY0YhoE8Drt01SPMpJTCnih2E0iPRA",
  authDomain: "attendx-b9a4f.firebaseapp.com",
  projectId: "attendx-b9a4f",
  storageBucket: "attendx-b9a4f.firebasestorage.app",
  messagingSenderId: "150847727618",
  appId: "1:150847727618:web:96bff456149dbaf1095f1b"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
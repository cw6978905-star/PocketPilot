import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

// Replace these values with the Web app config from Firebase Console.
const firebaseConfig = {
  apiKey: "AIzaSyBkxpAta0JXfjzJ2B3ogQyNg-74kpjxZ2E",
  authDomain: "pocketpilot-657c5.firebaseapp.com",
  projectId: "pocketpilot-657c5",
  storageBucket: "pocketpilot-657c5.firebasestorage.app",
  messagingSenderId: "781569741814",
  appId: "1:781569741814:web:a1e4ec67f91d25035c2dd7"
};


const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

await setPersistence(auth, browserLocalPersistence);

function userStateRef(uid) {
  return doc(db, 'users', uid, 'pocketpilot', 'state');
}

export {
  app,
  auth,
  db,
  userStateRef,
  getDoc,
  setDoc,
  signOut,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
};

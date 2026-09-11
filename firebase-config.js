// Firebase configuration provided for Englishly
const firebaseConfig = {
  apiKey: "AIzaSyAWoYzDKhdvMiCvjiG7E2zL5SXsjsh1zmU",
  authDomain: "mistri-bhai.firebaseapp.com",
  databaseURL: "https://mistri-bhai-default-rtdb.firebaseio.com",
  projectId: "mistri-bhai",
  storageBucket: "mistri-bhai.firebasestorage.app",
  messagingSenderId: "32038775514",
  appId: "1:32038775514:web:5d4983da67654bf48053e3",
  measurementId: "G-MS21FZJ9DZ"
};

// Initialize Firebase services with safe fallback
let firebaseApp = null;
let firebaseAuth = null;
let firebaseDb = null;
let currentUserId = null;
let isFirebaseConnected = false;

function initFirebase() {
  try {
    if (typeof firebase !== 'undefined' && firebase.initializeApp) {
      firebaseApp = firebase.initializeApp(firebaseConfig);
      firebaseAuth = firebase.auth();
      firebaseDb = firebase.database();

      // Sign in anonymously
      firebaseAuth.onAuthStateChanged((user) => {
        if (user) {
          currentUserId = user.uid;
          isFirebaseConnected = true;
          window.dispatchEvent(new CustomEvent('firebase-ready', { detail: { uid: user.uid } }));
        } else {
          firebaseAuth.signInAnonymously().catch((err) => {
            console.warn("Anonymous auth failed, running in local mode:", err.message);
            window.dispatchEvent(new CustomEvent('firebase-error', { detail: { error: err } }));
          });
        }
      });
    } else {
      console.warn("Firebase SDK not loaded, operating in local-only mode.");
    }
  } catch (err) {
    console.warn("Firebase initialization warning:", err.message);
    window.dispatchEvent(new CustomEvent('firebase-error', { detail: { error: err } }));
  }
}

// Export for app.js
window.FirebaseService = {
  init: initFirebase,
  getAuth: () => firebaseAuth,
  getDb: () => firebaseDb,
  getUid: () => currentUserId,
  isConnected: () => isFirebaseConnected
};

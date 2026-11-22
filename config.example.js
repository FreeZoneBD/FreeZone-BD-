// FreeZone BD - copy this file to  config.js  and fill in your Firebase web config.
// (Firebase Console > Project settings > Your apps > Web app > SDK setup and configuration)
// Use the SAME config.js you already use for the website.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

const app = initializeApp({
  apiKey: "PASTE_HERE",
  authDomain: "PASTE_HERE",
  databaseURL: "PASTE_HERE",
  projectId: "PASTE_HERE",
  appId: "PASTE_HERE"
});

export const auth = getAuth(app);
export const db = getDatabase(app);

// Later, for videos (Firebase Storage):
// import { getStorage } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-storage.js";
// export const storage = getStorage(app);

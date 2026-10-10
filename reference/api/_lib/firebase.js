import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

let app;

export function getDb() {
  if (!app) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error("Firebase Admin nao configurado no servidor.");
    }

    app = getApps().find((entry) => entry.name === 'central-reference') || initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey
      })
    }, 'central-reference');
  }

  return getFirestore(app);
}

export function now() {
  return FieldValue.serverTimestamp();
}

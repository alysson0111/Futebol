import admin from "firebase-admin";

let app;

export function getDb() {
  if (!app) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error("Firebase Admin nao configurado no servidor.");
    }

    app = admin.apps.find((entry) => entry.name === 'central-reference') || admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey
      })
    }, 'central-reference');
  }

  return admin.firestore(app);
}

export function now() {
  return admin.firestore.FieldValue.serverTimestamp();
}

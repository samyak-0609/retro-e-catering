// Run this script once to create or migrate the initial admin account.
// Usage: node backend/seed-admin.js

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const admin = require('firebase-admin');
const SA_PATH = require('path').join(__dirname, 'serviceAccountKey.json');

if (admin.apps.length === 0) {
  if (require('fs').existsSync(SA_PATH)) {
    admin.initializeApp({ credential: admin.credential.cert(SA_PATH) });
  } else {
    admin.initializeApp({ projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID });
  }
}

const authAdmin = admin.auth();
const db = admin.firestore();
const ADMIN_EMAIL = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

async function getOrCreateAuthUser(existingUid) {
  if (existingUid) {
    try {
      return await authAdmin.getUser(existingUid);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
    }
  }

  try {
    return await authAdmin.createUser({
      ...(existingUid ? { uid: existingUid } : {}),
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
  } catch (error) {
    if (error.code !== 'auth/email-already-exists') throw error;
    return authAdmin.getUserByEmail(ADMIN_EMAIL);
  }
}

async function seedAdmin() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in the root .env file.');
  }

  const existing = await db.collection('admins')
    .where('email', '==', ADMIN_EMAIL)
    .limit(1)
    .get();
  const oldUid = existing.empty ? null : existing.docs[0].id;
  const user = await getOrCreateAuthUser(oldUid);
  const adminDoc = db.collection('admins').doc(user.uid);

  // Keep credentials in Firebase Auth only, and remove the legacy plaintext
  // password field when migrating an existing admin record.
  await adminDoc.set({
    email: ADMIN_EMAIL,
    ...(existing.empty ? { createdAt: new Date().toISOString() } : {}),
    password: admin.firestore.FieldValue.delete(),
  }, { merge: true });

  if (oldUid && oldUid !== user.uid) {
    await db.collection('admins').doc(oldUid).delete();
  }
  console.log(`Admin account is ready: ${ADMIN_EMAIL} (${user.uid})`);
}

seedAdmin().catch((error) => {
  console.error('Admin setup failed:', error.message);
  process.exitCode = 1;
});

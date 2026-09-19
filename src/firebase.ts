import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithRedirect, 
  getRedirectResult, 
  signOut as fbSignOut, 
  onAuthStateChanged,
  browserLocalPersistence,
  setPersistence,
  User,
  Auth
} from 'firebase/auth';

// Explicitly use target project credentials as specified
const TARGET_PROJECT_ID = 'zang-5a585';
const TARGET_AUTH_DOMAIN = 'zang-5a585.firebaseapp.com';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyAvS4AgYiqb9ezNauFqo-Dk8K8NmuLqujw',
  authDomain: TARGET_AUTH_DOMAIN,
  projectId: TARGET_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || `${TARGET_PROJECT_ID}.firebasestorage.app`,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '693926134005',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let googleProvider: GoogleAuthProvider | null = null;

if (isFirebaseConfigured) {
  try {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    auth = getAuth(app);
    setPersistence(auth, browserLocalPersistence).catch((err) => {
      console.warn('Firebase persistence setup notice:', err);
    });
    googleProvider = new GoogleAuthProvider();
    googleProvider.setCustomParameters({ prompt: 'select_account' });
  } catch (err) {
    console.error('Failed to initialize Firebase Auth:', err);
  }
}

export { auth, googleProvider };

export async function loginWithGoogle(): Promise<User | void> {
  if (!auth || !googleProvider) {
    throw new Error(
      'Firebase Authentication belum dikonfigurasi. Harap periksa kredensial Firebase.'
    );
  }
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (popupError: any) {
    console.warn('Popup login notice, falling back to redirect if appropriate:', popupError);
    if (
      popupError?.code === 'auth/popup-blocked' ||
      popupError?.code === 'auth/popup-closed-by-user' ||
      popupError?.code === 'auth/cancelled-popup-request' ||
      popupError?.code === 'auth/operation-not-supported-in-this-environment'
    ) {
      if (popupError?.code === 'auth/popup-closed-by-user') {
        throw new Error('Login dibatalkan oleh pengguna.');
      }
      await signInWithRedirect(auth, googleProvider);
      return;
    }
    
    if (popupError?.code === 'auth/unauthorized-domain') {
      throw new Error(`Error (auth/unauthorized-domain): Domain "${window.location.hostname}" belum diizinkan di Firebase Console project zang-5a585.`);
    } else if (popupError?.code === 'auth/network-request-failed') {
      throw new Error('Koneksi internet bermasalah. Silakan periksa jaringan Anda dan coba lagi.');
    }
    
    throw new Error(popupError?.message || `Error Firebase (${popupError?.code || 'unknown'}): Login Google gagal.`);
  }
}

export async function checkRedirectResult(): Promise<User | null> {
  if (!auth) return null;
  try {
    const result = await getRedirectResult(auth);
    return result?.user || null;
  } catch (error: any) {
    console.error('getRedirectResult error:', error);
    if (error?.code === 'auth/unauthorized-domain') {
      throw new Error(`Error (auth/unauthorized-domain): Domain "${window.location.hostname}" belum diizinkan di Firebase Console project zang-5a585.`);
    }
    throw new Error(error?.message || `Error Login Firebase: ${error?.code || 'Gagal memproses redirect login'}`);
  }
}

export async function logoutUser(): Promise<void> {
  if (auth) {
    await fbSignOut(auth);
  }
}

export function subscribeToAuthState(callback: (user: User | null) => void): () => void {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

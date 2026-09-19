/**
 * Firebase Authentication disabled - System now uses Access Code & Admin Secret Authentication
 */

export const isFirebaseConfigured = false;

export async function loginWithGoogle(): Promise<void> {
  throw new Error('Login Google telah dinonaktifkan. Silakan gunakan Kode Akses.');
}

export async function checkRedirectResult(): Promise<null> {
  return null;
}

export async function logoutUser(): Promise<void> {
  return;
}

export function subscribeToAuthState(callback: (user: any) => void): () => void {
  callback(null);
  return () => {};
}

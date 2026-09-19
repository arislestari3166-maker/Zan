const fs = require('fs');
let code = fs.readFileSync('src/firebase.ts', 'utf8');

const newLogin = `export async function loginWithGoogle(): Promise<void> {
  if (!auth || !googleProvider) {
    throw new Error(
      'Firebase Authentication belum dikonfigurasi. Harap masukkan kredensial VITE_FIREBASE_API_KEY dan VITE_FIREBASE_PROJECT_ID.'
    );
  }
  try {
    await signInWithRedirect(auth, googleProvider);
  } catch (error: any) {
    if (error?.code === 'auth/network-request-failed') {
      throw new Error('Koneksi internet bermasalah. Silakan periksa jaringan Anda dan coba lagi.');
    }
    throw new Error(error?.message || 'Login Google gagal. Silakan coba lagi.');
  }
}

export async function checkRedirectResult(): Promise<User | null> {
  if (!auth) return null;
  try {
    const result = await getRedirectResult(auth);
    return result?.user || null;
  } catch (error: any) {
    throw new Error(error?.message || 'Gagal memproses hasil login Google.');
  }
}`;

code = code.replace(/export async function loginWithGoogle[\s\S]*?(?=export async function logoutUser)/, newLogin + '\n\n');

fs.writeFileSync('src/firebase.ts', code);
console.log('Patched firebase.ts');

const fs = require('fs');
let code = fs.readFileSync('src/components/LoginPage.tsx', 'utf8');

// Update imports
code = code.replace(
  /import { loginWithGoogle, isFirebaseConfigured } from '\.\.\/firebase';/,
  `import { loginWithGoogle, isFirebaseConfigured, checkRedirectResult } from '../firebase';`
);

// Add useEffect
code = code.replace(
  /const \[isLoading, setIsLoading\] = useState\(false\);/,
  `const [isLoading, setIsLoading] = useState(false);
  React.useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    checkRedirectResult()
      .then((user) => {
        if (isMounted) {
          setIsLoading(false);
          if (user && onLoginSuccess) onLoginSuccess();
        }
      })
      .catch((err) => {
        if (isMounted) {
          setIsLoading(false);
          setErrorMessage(err.message || 'Login gagal saat kembali dari Google.');
        }
      });
    return () => { isMounted = false; };
  }, [onLoginSuccess]);`
);

// Modify handleGoogleSignIn
code = code.replace(
  /const handleGoogleSignIn = async \(\) => {[\s\S]*?};\n\n  const handleCopyDomain/m,
  `const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setUnauthorizedDomain(null);

    try {
      if (!isFirebaseConfigured) {
        throw new Error(
          'Konfigurasi Firebase belum terdeteksi. Silakan atur VITE_FIREBASE_API_KEY & VITE_FIREBASE_PROJECT_ID di berkas environment.'
        );
      }
      await loginWithGoogle();
    } catch (err: any) {
      console.error('Google Sign-in Error:', err);
      setErrorMessage(err.message || 'Login Google gagal. Silakan coba lagi.');
      setIsLoading(false);
    }
  };

  const handleCopyDomain`
);

// Remove unauthorizedDomain block
code = code.replace(
  /\{\/\* Unauthorized Domain Resolution Banner \*\/\}\s*\{unauthorizedDomain && \([\s\S]*?\}\)\}/,
  ''
);

// Remove unauthorizedDomain from errorMessage check
code = code.replace(
  /\{errorMessage && !unauthorizedDomain && \(/,
  `{errorMessage && (`
);

fs.writeFileSync('src/components/LoginPage.tsx', code);
console.log('Patched LoginPage.tsx');

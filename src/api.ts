/**
 * Centralized API & Media URL Resolver
 * Connects both Preview and Public/Shared URLs directly to their server backend.
 */

export function getBaseApiUrl(): string {
  if (typeof window !== 'undefined' && (window as any).__CENTRAL_BACKEND_URL__) {
    return (window as any).__CENTRAL_BACKEND_URL__.replace(/\/+$/, '');
  }
  return '';
}

export function getApiUrl(path: string): string {
  const base = getBaseApiUrl();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (!base) return cleanPath;
  return `${base}${cleanPath}`;
}

export function getMediaUrl(rawUrl?: string): string {
  if (!rawUrl) return '';
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    return rawUrl;
  }
  
  // Normalize Windows/Linux backslashes
  let norm = rawUrl.replace(/\\/g, '/');
  
  // Find known media folders
  for (const prefix of ['/outputs/', '/storage/', '/downloads/', '/uploads/']) {
    const idx = norm.indexOf(prefix);
    if (idx !== -1) {
      norm = norm.slice(idx);
      break;
    }
  }
  
  if (norm.startsWith('outputs/') || norm.startsWith('storage/') || norm.startsWith('downloads/') || norm.startsWith('uploads/')) {
    norm = '/' + norm;
  }
  
  if (!norm.startsWith('/')) {
    norm = '/' + norm;
  }

  const base = getBaseApiUrl();
  if (!base) return norm;
  return `${base}${norm}`;
}

import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Zap, Key, ShieldCheck, Lock, ArrowRight, ArrowLeft, AlertCircle, Loader2 } from 'lucide-react';
import { UserSession, AdminSession } from '../types';

interface LoginPageProps {
  onUserLogin: (session: UserSession) => void;
  onAdminLogin: (session: AdminSession) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onUserLogin, onAdminLogin }) => {
  const [loginMode, setLoginMode] = useState<'user' | 'admin'>('user');
  const [accessCode, setAccessCode] = useState('');
  const [adminSecret, setAdminSecret] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessCode.trim()) {
      setErrorMessage('Masukkan kode akses terlebih dahulu.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/auth/user-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: accessCode.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Kode akses tidak valid.');
      }

      onUserLogin({
        role: 'user',
        token: data.token,
        userLabel: data.userLabel,
        code: data.code,
        hasApiKey: data.hasApiKey,
        maskedApiKey: data.maskedApiKey,
      });
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal masuk. Periksa kembali kode akses Anda.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminSecret) {
      setErrorMessage('Masukkan Admin Secret.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/auth/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: adminSecret }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Admin Secret tidak valid.');
      }

      onAdminLogin({
        role: 'admin',
        token: data.token,
      });
    } catch (err: any) {
      setErrorMessage(err.message || 'Admin Secret tidak valid.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fafafa] flex flex-col justify-between text-slate-900 font-sans selection:bg-blue-100 relative overflow-hidden">
      {/* Background Accent Graphics */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-100/40 rounded-full blur-3xl" />
        <div className="absolute top-1/2 -right-40 w-96 h-96 bg-amber-100/40 rounded-full blur-3xl" />
      </div>

      {/* Top Header */}
      <header className="relative z-10 max-w-7xl mx-auto w-full px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-slate-900 rounded-xl flex items-center justify-center text-white shadow-md shadow-slate-200">
            <Zap className="w-5 h-5 fill-current text-amber-400" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-slate-900 leading-none">RoboNeo</h1>
            <p className="text-[10px] text-slate-400 font-medium tracking-wide">MOTION CONTROL 2.6</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 bg-white/80 backdrop-blur border border-slate-200/80 px-3.5 py-1.5 rounded-full shadow-2xs">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span>Sistem Akses Resmi</span>
        </div>
      </header>

      {/* Main Login Card Container */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 sm:px-6 py-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="w-full max-w-lg bg-white rounded-3xl border border-slate-200 p-6 sm:p-9 shadow-lg shadow-slate-100/80 text-center"
        >
          {/* Main Logo & Identity */}
          <div className="mx-auto w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-slate-300 mb-5">
            <Zap className="w-9 h-9 fill-current text-amber-400" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900 mb-1">
            ROBONEO
          </h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">
            VERSION 2.6 STANDARD
          </p>

          {/* Error Message Display */}
          {errorMessage && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-start gap-2.5 text-left"
            >
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span>{errorMessage}</span>
              </div>
            </motion.div>
          )}

          {/* USER LOGIN FORM */}
          {loginMode === 'user' ? (
            <form onSubmit={handleUserSubmit} className="space-y-4 text-left">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
                  Kode Akses
                </label>
                <div className="relative">
                  <Key className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={accessCode}
                    onChange={(e) => setAccessCode(e.target.value)}
                    placeholder="[ Masukkan kode akses ]"
                    autoFocus
                    className="w-full h-13 pl-12 pr-4 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white text-slate-900 font-mono font-bold text-sm tracking-wider focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-all uppercase placeholder:normal-case placeholder:font-sans placeholder:font-normal placeholder:tracking-normal"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-13 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md shadow-slate-200 active:scale-[0.99] disabled:opacity-50 cursor-pointer"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>MEMPROSES...</span>
                  </>
                ) : (
                  <>
                    <span>MASUK DENGAN KODE AKSES</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <div className="pt-4 border-t border-slate-100 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setLoginMode('admin');
                    setErrorMessage(null);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors cursor-pointer"
                >
                  <Lock className="w-3.5 h-3.5 text-amber-500" />
                  <span>Login sebagai Admin</span>
                </button>
              </div>
            </form>
          ) : (
            /* ADMIN LOGIN FORM */
            <form onSubmit={handleAdminSubmit} className="space-y-4 text-left">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
                  Admin Secret
                </label>
                <div className="relative">
                  <Lock className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    value={adminSecret}
                    onChange={(e) => setAdminSecret(e.target.value)}
                    placeholder="[ Masukkan Admin Secret ]"
                    autoFocus
                    className="w-full h-13 pl-12 pr-4 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white text-slate-900 font-mono font-bold text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-all placeholder:font-sans placeholder:font-normal"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-13 rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-sm flex items-center justify-center gap-2 transition-all shadow-md shadow-amber-200 active:scale-[0.99] disabled:opacity-50 cursor-pointer"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>MEMVERIFIKASI...</span>
                  </>
                ) : (
                  <>
                    <span>MASUK SEBAGAI ADMIN</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <div className="pt-4 border-t border-slate-100 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setLoginMode('user');
                    setErrorMessage(null);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Kembali ke Login Kode Akses</span>
                </button>
              </div>
            </form>
          )}
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-6 text-center text-xs text-slate-400">
        <p>© 2026 RoboNeo Motion Control — All system rights reserved.</p>
      </footer>
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { Key, Check, Loader2, ShieldCheck, Lock, Eye, EyeOff } from 'lucide-react';

interface UserApiKeySectionProps {
  token: string;
  hasApiKey: boolean;
  maskedApiKey: string | null;
  onApiKeyUpdated: (maskedKey: string) => void;
}

export const UserApiKeySection: React.FC<UserApiKeySectionProps> = ({
  token,
  hasApiKey,
  maskedApiKey,
  onApiKeyUpdated,
}) => {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const handleSaveApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKeyInput.trim()) {
      setMessage({ text: 'Masukkan API Key terlebih dahulu.', type: 'error' });
      return;
    }

    setIsSaving(true);
    setMessage(null);

    try {
      const res = await fetch('/api/user/api-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ apiKey: apiKeyInput.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal menyimpan API Key.');
      }

      setMessage({ text: 'API Key berhasil disimpan!', type: 'success' });
      setApiKeyInput('');
      onApiKeyUpdated(data.maskedApiKey);
    } catch (err: any) {
      setMessage({ text: err.message || 'Gagal menyimpan API Key.', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-2xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-600 border border-amber-200/60">
            <Key className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-900 tracking-tight flex items-center gap-2">
              <span>API KEY USER</span>
              {hasApiKey ? (
                <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold px-2 py-0.5 rounded-full">
                  🟢 TERPASANG
                </span>
              ) : (
                <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 font-bold px-2 py-0.5 rounded-full">
                  ⚠️ BELUM ADA
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-500">
              API key khusus milik akun Anda. Digunakan secara otomatis saat memproses video generation.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-full self-start sm:self-auto">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>Tersimpan Aman di Backend</span>
        </div>
      </div>

      {/* Masked status banner if exists */}
      {hasApiKey && (
        <div className="mb-4 p-3 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2 font-mono text-xs font-bold text-slate-800">
            <Lock className="w-3.5 h-3.5 text-slate-400" />
            <span>Aktif: {maskedApiKey || '●●●●●●●●'}</span>
          </div>
          <span className="text-[11px] text-slate-400">Tersimpan untuk sesi Anda</span>
        </div>
      )}

      {/* Save API Key Form */}
      <form onSubmit={handleSaveApiKey} className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <input
              type={showInput ? 'text' : 'password'}
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="[ Masukkan API Key Anda ]"
              className="w-full h-11 pl-4 pr-10 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 transition-all placeholder:normal-case placeholder:font-sans placeholder:font-normal"
            />
            <button
              type="button"
              onClick={() => setShowInput(!showInput)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              {showInput ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <button
            type="submit"
            disabled={isSaving}
            className="h-11 px-6 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>MENYIMPAN...</span>
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>SIMPAN API KEY</span>
              </>
            )}
          </button>
        </div>

        {message && (
          <p
            className={`text-xs font-bold px-1 ${
              message.type === 'success' ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            {message.text}
          </p>
        )}
      </form>
    </div>
  );
};

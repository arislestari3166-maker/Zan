import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Users,
  CheckCircle2,
  XCircle,
  Plus,
  Copy,
  Check,
  Power,
  Trash2,
  LogOut,
  Zap,
  ShieldCheck,
  RefreshCw,
  Search,
  Clock,
  Key
} from 'lucide-react';
import { AccessCode } from '../types';

interface AdminPanelProps {
  token: string;
  onLogout: () => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ token, onLogout }) => {
  const [codes, setCodes] = useState<AccessCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Newly created code state for copy banner
  const [newlyCreatedCode, setNewlyCreatedCode] = useState<AccessCode | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const fetchCodes = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/codes', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error('Gagal mengambil daftar kode.');
      }
      const data = await res.json();
      setCodes(data);
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan saat memuat data.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCodes();
  }, [token]);

  const handleCreateCode = async () => {
    setIsCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/codes', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal membuat kode user.');

      setNewlyCreatedCode(data.codeEntry);
      fetchCodes();
    } catch (err: any) {
      setError(err.message || 'Gagal membuat kode user.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleStatus = async (id: string, currentStatus: 'active' | 'inactive') => {
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    try {
      const res = await fetch(`/api/admin/codes/${id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Gagal mengubah status.');
      fetchCodes();
    } catch (err: any) {
      alert(err.message || 'Gagal mengubah status.');
    }
  };

  const handleDeleteCode = async (id: string, userLabel: string) => {
    if (!window.confirm(`Apakah Anda yakin ingin menghapus/revoke kode untuk ${userLabel}?`)) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/codes/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Gagal menghapus kode.');
      fetchCodes();
    } catch (err: any) {
      alert(err.message || 'Gagal menghapus kode.');
    }
  };

  const handleCopy = (codeText: string) => {
    navigator.clipboard.writeText(codeText);
    setCopiedCode(codeText);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  // Stats calculation
  const totalUser = codes.length;
  const activeUser = codes.filter((c) => c.status === 'active').length;
  const inactiveUser = codes.filter((c) => c.status === 'inactive').length;

  // Filtered list
  const filteredCodes = codes.filter(
    (c) =>
      c.userLabel.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDate = (timestamp: number | null) => {
    if (!timestamp) return 'Belum pernah';
    return new Date(timestamp).toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-[#fafafa] text-slate-900 font-sans pb-16">
      {/* Top Navigation */}
      <header className="bg-slate-900 text-white sticky top-0 z-30 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-500 rounded-xl flex items-center justify-center text-slate-950 font-black shadow-sm">
              <Zap className="w-5 h-5 fill-current" />
            </div>
            <div>
              <h1 className="text-base font-black tracking-tight flex items-center gap-2">
                <span>ROBONEO ADMIN PANEL</span>
                <span className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 font-bold px-2 py-0.5 rounded-md">
                  ADMIN
                </span>
              </h1>
              <p className="text-[11px] text-slate-400">Manajemen Kode Akses User</p>
            </div>
          </div>

          <button
            onClick={onLogout}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-rose-600/90 text-slate-200 hover:text-white text-xs font-bold transition-all border border-slate-700 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Logout Admin</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-8 space-y-8">
        {/* STATS OVERVIEW CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-2xs flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total User</p>
              <h3 className="text-3xl font-black text-slate-900 mt-1">{totalUser}</h3>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-700">
              <Users className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-3xl border border-emerald-100 shadow-2xs flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Kode Aktif</p>
              <h3 className="text-3xl font-black text-emerald-700 mt-1">{activeUser}</h3>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-3xl border border-rose-100 shadow-2xs flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-rose-500 uppercase tracking-wider">Kode Nonaktif</p>
              <h3 className="text-3xl font-black text-rose-600 mt-1">{inactiveUser}</h3>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <XCircle className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* NEWLY CREATED CODE BANNER */}
        <AnimatePresence>
          {newlyCreatedCode && (
            <motion.div
              initial={{ opacity: 0, scale: 0.98, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="p-6 rounded-3xl bg-emerald-950 text-white border border-emerald-800 shadow-lg relative overflow-hidden"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                      Kode Berhasil Dibuat
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-emerald-100">
                    Akses baru untuk <strong className="text-white">{newlyCreatedCode.userLabel}</strong> telah diterbitkan:
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="px-5 py-2.5 bg-slate-900 border border-emerald-700 rounded-2xl font-mono text-xl font-black tracking-widest text-amber-300 shadow-inner">
                    {newlyCreatedCode.code}
                  </div>
                  <button
                    onClick={() => handleCopy(newlyCreatedCode.code)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-all shadow-md cursor-pointer"
                  >
                    {copiedCode === newlyCreatedCode.code ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Tersalin!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Salin Kode</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setNewlyCreatedCode(null)}
                    className="text-emerald-400 hover:text-white text-xs px-2 cursor-pointer"
                  >
                    Tutup
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ACTION BAR & TABLE */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="p-5 sm:p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Daftar Kode Akses User</h2>
              <p className="text-xs text-slate-500">Kelola izin masuk dan status setiap pengguna RoboNeo.</p>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari user / kode..."
                  className="pl-9 pr-4 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 w-48 sm:w-60"
                />
              </div>

              <button
                onClick={handleCreateCode}
                disabled={isCreating}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>+ BUAT KODE USER</span>
              </button>
            </div>
          </div>

          {/* TABLE OF CODES */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-100">
                  <th className="py-3.5 px-6">User</th>
                  <th className="py-3.5 px-6">Kode Akses</th>
                  <th className="py-3.5 px-6">Status</th>
                  <th className="py-3.5 px-6">Kapan Dibuat</th>
                  <th className="py-3.5 px-6">Terakhir Digunakan</th>
                  <th className="py-3.5 px-6 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      Memuat daftar kode akses...
                    </td>
                  </tr>
                ) : filteredCodes.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      Belum ada kode akses yang terdaftar. Klik "+ BUAT KODE USER" untuk membuat baru.
                    </td>
                  </tr>
                ) : (
                  filteredCodes.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-4 px-6 font-bold text-slate-900 flex items-center gap-2">
                        <Users className="w-4 h-4 text-slate-400" />
                        <span>{item.userLabel}</span>
                      </td>

                      <td className="py-4 px-6 font-mono font-bold text-slate-900">
                        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200">
                          <Key className="w-3.5 h-3.5 text-slate-500" />
                          <span>{item.code}</span>
                          <button
                            onClick={() => handleCopy(item.code)}
                            title="Salin Kode"
                            className="text-slate-400 hover:text-slate-900 transition-colors ml-1 cursor-pointer"
                          >
                            {copiedCode === item.code ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </td>

                      <td className="py-4 px-6">
                        {item.status === 'active' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                            🟢 Aktif
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            <span className="w-2 h-2 rounded-full bg-rose-500" />
                            🔴 Nonaktif
                          </span>
                        )}
                      </td>

                      <td className="py-4 px-6 text-slate-500">
                        {formatDate(item.createdAt)}
                      </td>

                      <td className="py-4 px-6 text-slate-500">
                        {formatDate(item.lastUsedAt)}
                      </td>

                      <td className="py-4 px-6 text-right space-x-2">
                        <button
                          onClick={() => handleToggleStatus(item.id, item.status)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                            item.status === 'active'
                              ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'
                              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                          }`}
                        >
                          {item.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>

                        <button
                          onClick={() => handleDeleteCode(item.id, item.userLabel)}
                          className="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-xs font-bold transition-all cursor-pointer"
                          title="Hapus / Revoke Kode"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
};

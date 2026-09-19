import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, 
  Video, 
  Image as ImageIcon, 
  Send, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Download,
  AlertCircle,
  AlertTriangle,
  Activity,
  History,
  Key as KeyIcon,
  Plus,
  Trash2,
  RefreshCw,
  Search,
  FileText,
  Copy,
  ChevronRight,
  ShieldCheck,
  Zap,
  Sparkles,
  Maximize2
} from 'lucide-react';
import { Job, JobStatus, AccessKey, KeyStatus } from './types';
import { getApiUrl, getMediaUrl } from './api';

type ActiveTab = 'generations' | 'pool';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('generations');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [prevJobStatuses, setPrevJobStatuses] = useState<Record<string, string>>({});

  useEffect(() => {
    // Check for transitions to 'Failed' with 'INSUFFICIENT_CARROTS'
    jobs.forEach(job => {
      if (
        job.status === 'Failed' && 
        job.errorCategory === 'INSUFFICIENT_CARROTS' &&
        prevJobStatuses[job.id] !== 'Failed'
      ) {
        setTopToast({
          visible: true,
          type: 'error',
          message: 'SEMUA AKUN TIDAK CUKUP GENERET TOLONG PASTIKAN AKUN ROBONEO ANDA CUKUP',
        });
        setTimeout(() => setTopToast(prev => ({ ...prev, visible: false })), 5000);
      }
    });
    
    // Update prev statuses
    const newStatuses: Record<string, string> = {};
    jobs.forEach(j => newStatuses[j.id] = j.status || '');
    setPrevJobStatuses(newStatuses);
  }, [jobs, prevJobStatuses]);
  const [keys, setKeys] = useState<AccessKey[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState<'banana_pro' | 'banana_2' | 'gpt_image_2'>('banana_pro');
  const [bananaProResolution, setBananaProResolution] = useState<'1K' | '2K' | '4K'>('1K');
  const [gptImageQuality, setGptImageQuality] = useState<'standard' | 'high'>('standard');
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '16:9' | '9:16'>('1:1');
  const [refFiles, setRefFiles] = useState<File[]>([]);
  const [generationType] = useState<'image'>('image');
  const [autoUpscale, setAutoUpscale] = useState(() => {
    return localStorage.getItem('auto_upscale_pref') === 'true';
  });

  const handleToggleAutoUpscale = (enabled: boolean) => {
    setAutoUpscale(enabled);
    localStorage.setItem('auto_upscale_pref', enabled ? 'true' : 'false');
  };
  const [isUpscalingManual, setIsUpscalingManual] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Backend connection & Job filtering states
  const [isBackendConnected, setIsBackendConnected] = useState(false);
  const [jobFilter, setJobFilter] = useState<'PROCESSING' | 'SELESAI' | 'INVALID'>('PROCESSING');

  // Pool management state
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState<'single' | 'bulk'>('bulk');
  const [bulkInput, setBulkInput] = useState('');
  const [isAddingKeys, setIsAddingKeys] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSyncingAllCarrots, setIsSyncingAllCarrots] = useState(false);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const [addModalError, setAddModalError] = useState<string | null>(null);

  // Custom Deletion Confirmation Modals
  const [showDeleteAllKeysModal, setShowDeleteAllKeysModal] = useState(false);
  const [showDeleteJobsModal, setShowDeleteJobsModal] = useState(false);
  const [isDeletingAllKeys, setIsDeletingAllKeys] = useState(false);
  const [isDeletingJobs, setIsDeletingJobs] = useState(false);

  // Top Floating Toast Popup State ("🟡 Sedang dikirim ke server RoboNeo...")
  const [topToast, setTopToast] = useState<{
    visible: boolean;
    type: 'sending' | 'success' | 'error';
    message: string;
  }>({
    visible: false,
    type: 'sending',
    message: '',
  });

  // Generating Popup Modal State ("Sedang memproses ke server roboneo")
  const [showGeneratingModal, setShowGeneratingModal] = useState(false);
  const [activeGeneratingJobId, setActiveGeneratingJobId] = useState<string | null>(null);
  const [uploadProgressText, setUploadProgressText] = useState('');

  const openAddModal = () => {
    setAddModalError(null);
    setBulkInput('');
    setShowAddModal(true);
  };

  const refFilesInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Poll for data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [jobsRes, keysRes, healthRes] = await Promise.all([
          fetch(getApiUrl('/api/jobs')).catch(() => null),
          fetch(getApiUrl('/api/keys')).catch(() => null),
          fetch(getApiUrl('/api/health')).catch(() => null)
        ]);
        
        if (healthRes && healthRes.ok) {
          const healthData = await healthRes.json().catch(() => null);
          setIsBackendConnected(healthData && healthData.ok === true);
        } else {
          setIsBackendConnected(false);
        }

        if (jobsRes && jobsRes.ok && jobsRes.headers.get('content-type')?.includes('application/json')) {
          setJobs(await jobsRes.json());
        }
        if (keysRes && keysRes.ok && keysRes.headers.get('content-type')?.includes('application/json')) {
          setKeys(await keysRes.json());
        }
      } catch (err) {
        console.error('Failed to fetch data', err);
        setIsBackendConnected(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleRetryJob = async (jobId: string) => {
    try {
      setActiveGeneratingJobId(jobId);
      setTopToast({
        visible: true,
        type: 'sending',
        message: '🟡 Sedang dikirim ke server RoboNeo...',
      });

      const res = await fetch(getApiUrl(`/api/jobs/${jobId}/retry`), { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'Waiting', error: undefined, roomId: undefined, logs: [] } : j));
          setTopToast({
            visible: true,
            type: 'success',
            message: '🟢 Berhasil dikirim ke server RoboNeo',
          });
          setTimeout(() => {
            setTopToast(prev => ({ ...prev, visible: false }));
          }, 3000);
        }
      } else {
        setTopToast({
          visible: true,
          type: 'error',
          message: '🔴 Gagal dikirim ke server RoboNeo',
        });
        setTimeout(() => {
          setTopToast(prev => ({ ...prev, visible: false }));
        }, 4000);
      }
    } catch (e: any) {
      console.error('Failed to retry job', e);
      setTopToast({
        visible: true,
        type: 'error',
        message: `🔴 Gagal: ${e.message}`,
      });
      setTimeout(() => {
        setTopToast(prev => ({ ...prev, visible: false }));
      }, 4000);
    }
  };

  const handleManualUpscale = async (jobId: string) => {
    try {
      setIsUpscalingManual(jobId);
      const res = await fetch(getApiUrl(`/api/jobs/${jobId}/upscale`), { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.job) {
          setJobs(prev => prev.map(j => j.id === jobId ? data.job : j));
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || 'Gagal melakukan upscale video');
      }
    } catch (e) {
      console.error('Failed to upscale job', e);
    } finally {
      setIsUpscalingManual(null);
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    try {
      const res = await fetch(getApiUrl(`/api/jobs/${jobId}`), { method: 'DELETE' });
      if (res.ok) {
        setJobs(prev => prev.filter(j => j.id !== jobId));
      }
    } catch (e) {
      console.error('Failed to delete job', e);
    }
  };

  const handleBulkDelete = () => {
    setShowDeleteJobsModal(true);
  };

  const executeBulkDeleteJobs = async () => {
    setIsDeletingJobs(true);
    try {
      let query = '';
      if (jobFilter === 'SELESAI') query = '?status=Completed';
      else if (jobFilter === 'INVALID') query = '?status=Failed';
      else if (jobFilter === 'PROCESSING') query = '?status=Processing';

      const res = await fetch(getApiUrl(`/api/jobs${query}`), { method: 'DELETE' });
      if (res.ok) {
        const fetchRes = await fetch(getApiUrl('/api/jobs'));
        if (fetchRes.ok) setJobs(await fetchRes.json());
        setShowDeleteJobsModal(false);
      }
    } catch (e) {
      console.error('Failed to bulk delete jobs', e);
    } finally {
      setIsDeletingJobs(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (refFiles.length === 0) {
      setError('Silakan pilih minimal 1 gambar.');
      return;
    }

    setIsUploading(true);
    setError(null);
    setTopToast({
      visible: true,
      type: 'sending',
      message: '🟡 Sedang dikirim ke server RoboNeo...',
    });

    const formData = new FormData();
    formData.append('image', refFiles[0]);
    formData.append('prompt', prompt);
    formData.append('selectedModel', selectedModel);
    formData.append('resolution', bananaProResolution);
    formData.append('quality', gptImageQuality);
    formData.append('aspectRatio', aspectRatio);
    formData.append('autoUpscale', autoUpscale ? 'true' : 'false');
    formData.append('jobType', 'image');
    
    // Append optional additional reference images starting from index 1
    if (refFiles.length > 1) {
      refFiles.slice(1).forEach((file) => {
        formData.append('refImages', file);
      });
    }

    try {
      const res = await fetch(getApiUrl('/api/jobs'), {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        let errorMsg = 'Upload failed';
        if (res.headers.get('content-type')?.includes('application/json')) {
          const data = await res.json();
          errorMsg = data.error || errorMsg;
        } else {
          errorMsg = `Server error (${res.status}): ${res.statusText}`;
        }
        throw new Error(errorMsg);
      }

      const data = await res.json();
      if (data.jobId) {
        setActiveGeneratingJobId(data.jobId);
        setTopToast({
          visible: true,
          type: 'success',
          message: '🟢 Berhasil dikirim ke server RoboNeo',
        });
        setTimeout(() => {
          setTopToast(prev => ({ ...prev, visible: false }));
        }, 3000);
      }

      setPrompt('');
      setRefFiles([]);
      if (refFilesInputRef.current) refFilesInputRef.current.value = '';
    } catch (err: any) {
      setError(err.message);
      setTopToast({
        visible: true,
        type: 'error',
        message: `🔴 Gagal dikirim ke server RoboNeo: ${err.message}`,
      });
      setTimeout(() => {
        setTopToast(prev => ({ ...prev, visible: false }));
      }, 4000);
    } finally {
      setIsUploading(false);
    }
  };

  const handleAddKeys = async () => {
    if (!bulkInput.trim()) return;
    setIsAddingKeys(true);
    setAddModalError(null);
    
    // Support multiple delimiters: newline, comma, semicolon, space
    const keyList = bulkInput
      .split(/[\n,; \t]+/)
      .map(k => k.trim())
      .filter(k => k.length > 0);
    
    if (keyList.length === 0) {
      setAddModalError('Format key tidak valid. Masukkan minimal satu access key.');
      setIsAddingKeys(false);
      return;
    }
    
    try {
      const res = await fetch(getApiUrl('/api/keys/bulk'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: keyList }),
      });
      
      const data = await res.json().catch(() => ({}));
      
      if (!res.ok) {
        throw new Error(data.error || 'Gagal menambahkan akun ke pool.');
      }
      
      // Provide feedback on what happened
      const added = data.filter((r: any) => r.status === 'Added').length;
      const dupes = data.filter((r: any) => r.status === 'Duplicate').length;
      
      if (added === 0 && dupes > 0) {
        setAddModalError(`Semua key (${dupes}) sudah ada di dalam pool.`);
        setIsAddingKeys(false);
        return;
      }
      
      setBulkInput('');
      setShowAddModal(false);
    } catch (err: any) {
      console.error('Failed to add keys', err);
      setAddModalError(err.message || 'Gagal terhubung ke server backend.');
    } finally {
      setIsAddingKeys(false);
    }
  };

  const deleteKey = async (id: string) => {
    try {
      await fetch(getApiUrl(`/api/keys/${id}`), { method: 'DELETE' });
    } catch (err) {
      console.error('Failed to delete key', err);
    }
  };

  const validateKey = async (id: string) => {
    try {
      await fetch(getApiUrl(`/api/keys/${id}/validate`), { method: 'POST' });
    } catch (err) {
      console.error('Failed to validate key', err);
    }
  };

  const handleSyncAllCarrots = async () => {
    setIsSyncingAllCarrots(true);
    try {
      await fetch(getApiUrl('/api/keys/sync-carrots'), { method: 'POST' });
    } catch (err) {
      console.error('Failed to sync all carrots', err);
    } finally {
      setTimeout(() => setIsSyncingAllCarrots(false), 3000);
    }
  };

  const handleSyncCloud = async () => {
    setIsSyncingCloud(true);
    try {
      const res = await fetch(getApiUrl('/api/jobs/sync'), { method: 'POST' });
      if (res.ok) {
        const fetchRes = await fetch(getApiUrl('/api/jobs'));
        if (fetchRes.ok) setJobs(await fetchRes.json());
      }
    } catch (e) {
      console.error('Failed to sync cloud history', e);
    } finally {
      setIsSyncingCloud(false);
    }
  };

  const handleDeleteAllKeys = () => {
    setShowDeleteAllKeysModal(true);
  };

  const executeDeleteAllKeys = async () => {
    setIsDeletingAllKeys(true);
    try {
      const res = await fetch(getApiUrl('/api/keys'), { method: 'DELETE' });
      if (res.ok) {
        setKeys([]);
        setShowDeleteAllKeysModal(false);
      }
    } catch (err) {
      console.error('Failed to delete all keys', err);
    } finally {
      setIsDeletingAllKeys(false);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.txt')) {
      const reader = new FileReader();
      reader.onload = (re) => {
        setBulkInput(re.target?.result as string);
      };
      reader.readAsText(file);
    }
  };

  const handleRefFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setRefFiles(prev => {
      const combined = [...prev, ...files];
      return combined.slice(0, 6); // Limit to 6 files
    });
  };

  const handleRemoveRefFile = (index: number) => {
    setRefFiles(prev => prev.filter((_, i) => i !== index));
  };

  const getStatusIcon = (status: JobStatus) => {
    switch (status) {
      case 'Completed': return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
      case 'Failed': return <XCircle className="w-5 h-5 text-rose-500" />;
      case 'Waiting': return <Clock className="w-5 h-5 text-slate-400 animate-pulse" />;
      case 'Upscaling 2K': return <Sparkles className="w-5 h-5 text-purple-600 animate-spin" />;
      default: return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
    }
  };

  const getStatusColor = (status: JobStatus) => {
    switch (status) {
      case 'Completed': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'Failed': return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'Waiting':
      case 'QUEUED': return 'bg-slate-50 text-slate-600 border-slate-200';
      case 'VALIDATING':
      case 'MEDIA_READY': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'PREPROCESSING': return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      case 'ACCOUNT_SELECTING': return 'bg-violet-50 text-violet-700 border-violet-200';
      case 'SUBMITTING':
      case 'Creating Room':
      case 'Uploading': return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'Processing':
      case 'PROCESSING':
      case 'ROBO_NEO_PROCESSING': return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'Downloading': return 'bg-cyan-50 text-cyan-700 border-cyan-200';
      case 'Upscaling 2K': return 'bg-purple-50 text-purple-700 border-purple-200';
      default: return 'bg-slate-50 text-slate-500 border-slate-200';
    }
  };

  const getKeyStatusColor = (status: KeyStatus) => {
    switch (status) {
      case 'Ready': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'Busy': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'Reserved': return 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse';
      case 'Invalid': return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'Disabled': return 'bg-slate-50 text-slate-600 border-slate-200';
      case 'Validating': return 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse';
    }
  };

  const filteredKeys = keys.filter(k => k.key.toLowerCase().includes(searchQuery.toLowerCase()));
  // Video load error tracking
  const [videoErrors, setVideoErrors] = useState<Record<string, boolean>>({});

  const getRequiredCarrots = () => {
    // Image type
    if (selectedModel === 'banana_pro') {
      if (bananaProResolution === '4K') return 46;
      return 26; // 1K or 2K
    }
    if (selectedModel === 'gpt_image_2') {
      if (gptImageQuality === 'high') return 41;
      return 11; // Standard
    }
    return 15; // default banana_2
  };

  const requiredCarrots = getRequiredCarrots();
  const readyKeysEligible = keys.filter(k => (k.status === 'Ready' || k.status === 'Busy') && (k.carrots === undefined || k.carrots >= requiredCarrots));
  const readyKeysLow = keys.filter(k => k.status === 'Ready' && k.carrots !== undefined && k.carrots < requiredCarrots);
  const maxCarrotsInPool = keys.filter(k => k.status === 'Ready').reduce((max, k) => Math.max(max, k.carrots || 0), 0);

  const stats = {
    total: keys.length,
    ready: readyKeysEligible.length,
    lowCarrots: readyKeysLow.length,
    totalCarrots: keys.reduce((sum, k) => sum + (k.carrots || 0), 0),
    invalid: keys.filter(k => k.status === 'Invalid').length,
    maxCarrots: maxCarrotsInPool
  };

  return (
    <div className="min-h-screen bg-[#fafafa] text-slate-900 font-sans selection:bg-blue-65">
      {/* Floating Top Notification Toast */}
      <AnimatePresence>
        {topToast.visible && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -40, scale: 0.9 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-auto max-w-md w-[92%] sm:w-auto"
          >
            <div className={`px-5 py-3.5 rounded-2xl shadow-2xl border flex items-center justify-between gap-4 backdrop-blur-xl ${
              topToast.type === 'sending'
                ? 'bg-slate-900/95 border-amber-500/50 text-white shadow-amber-500/10'
                : topToast.type === 'success'
                  ? 'bg-slate-900/95 border-emerald-500/50 text-white shadow-emerald-500/10'
                  : 'bg-slate-900/95 border-rose-500/50 text-white shadow-rose-500/10'
            }`}>
              <div className="flex items-center gap-3">
                {topToast.type === 'sending' && (
                  <span className="relative flex h-3 w-3 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
                  </span>
                )}
                {topToast.type === 'success' && (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                )}
                {topToast.type === 'error' && (
                  <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
                )}

                <div className="flex flex-col">
                  <span className="text-xs font-black tracking-tight text-white">
                    {topToast.message}
                  </span>
                  {topToast.type === 'sending' && (
                    <span className="text-[10px] text-slate-300 font-medium mt-0.5">
                      Halaman tetap terlihat & dapat diakses.
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setTopToast(prev => ({ ...prev, visible: false }))}
                className="text-slate-400 hover:text-white text-xs font-bold p-1 rounded-lg hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
              >
                ✕
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Responsive Header */}
      <header className="border-b border-slate-200 bg-white/95 backdrop-blur-md sticky top-0 z-50 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex flex-col md:flex-row items-center justify-between gap-3 sm:gap-4">
          <div className="flex items-center justify-between w-full md:w-auto gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-white shadow-lg shadow-slate-200 shrink-0">
                <Zap className="w-5 h-5 fill-current text-amber-400" />
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 leading-tight">RoboNeo Image to Image</h1>
                <p className="text-[10px] sm:text-xs text-slate-500 font-semibold tracking-wider">VERSION 3.0 COMPLETE</p>
              </div>
            </div>

            {/* Mobile status indicator */}
            <div className="md:hidden flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${isBackendConnected ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`} />
              <span className="text-[10px] font-bold text-slate-600 uppercase">
                {jobs.filter(j => j.status !== 'Completed' && j.status !== 'Failed').length} Jobs
              </span>
            </div>
          </div>
          
          {/* Navigation Tabs */}
          <nav className="flex items-center bg-slate-65 p-1 rounded-2xl border border-slate-200 shadow-inner w-full sm:w-auto justify-center">
            <button 
              onClick={() => setActiveTab('generations')}
              className={`flex-1 sm:flex-initial px-5 sm:px-6 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all text-center ${activeTab === 'generations' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Generations
            </button>
            <button 
              onClick={() => setActiveTab('pool')}
              className={`flex-1 sm:flex-initial px-5 sm:px-6 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all text-center ${activeTab === 'pool' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Account Pool ({stats.total})
            </button>
          </nav>

          {/* Desktop status info */}
          <div className="hidden md:flex items-center gap-3">
            <div className={`px-3 py-1.5 rounded-full text-[10px] font-black border flex items-center gap-1.5 transition-all shadow-2xs ${
              isBackendConnected 
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                : 'bg-rose-50 text-rose-700 border-rose-200 animate-pulse'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isBackendConnected ? 'bg-emerald-500 shadow-sm shadow-emerald-400' : 'bg-rose-500 shadow-sm shadow-rose-400'}`} />
              <span>STATUS: {isBackendConnected ? 'ONLINE' : 'OFFLINE'}</span>
            </div>
            <div className="px-3 py-1.5 bg-slate-65 rounded-full text-[11px] font-bold text-slate-600 border border-slate-200">
              {jobs.filter(j => j.status !== 'Completed' && j.status !== 'Failed').length} Active
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <AnimatePresence mode="wait">
          {activeTab === 'generations' ? (
            <motion.div 
              key="gen"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-12"
            >
              {/* Left Column: Control Panel */}
              <div className="lg:col-span-5 space-y-8">
                <section className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                  <div className="mb-6">
                    <h2 className="text-2xl font-bold mb-1.5">New Generation</h2>
                    <p className="text-slate-500 text-sm mb-4">Pilih model rendering RoboNeo untuk memproses gambar referensi Anda.</p>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Optional Reference Images */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold uppercase tracking-widest text-slate-400 ml-1">Gambar Referensi (Pilih 1 - 6 Gambar)</label>
                        <span className="text-[10px] font-black uppercase text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200/60 font-mono">
                          {refFiles.length === 6 ? 'Slot Penuh' : `Sisa ${6 - refFiles.length} Slot`}
                        </span>
                      </div>
                      
                      <input 
                        type="file" 
                        ref={refFilesInputRef} 
                        className="hidden" 
                        accept="image/*" 
                        multiple 
                        onChange={handleRefFilesChange} 
                      />

                      {refFiles.length === 0 ? (
                        <div 
                          onClick={() => refFilesInputRef.current?.click()}
                          className="relative h-24 rounded-2xl border-2 border-dashed border-slate-200 hover:border-slate-300 bg-slate-50/50 transition-all cursor-pointer flex flex-col items-center justify-center gap-1.5"
                        >
                          <Plus className="w-5 h-5 text-slate-400" />
                          <span className="text-xs font-bold text-slate-500">Pilih gambar (Sisa 6 slot)</span>
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                          {refFiles.map((file, idx) => (
                            <div key={idx} className="relative group aspect-square rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                              <img 
                                src={URL.createObjectURL(file)} 
                                alt={`ref-${idx}`} 
                                className="w-full h-full object-cover" 
                              />
                              <button
                                type="button"
                                onClick={() => handleRemoveRefFile(idx)}
                                className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4 text-white" />
                              </button>
                            </div>
                          ))}
                          {refFiles.length < 6 && (
                            <button
                              type="button"
                              onClick={() => refFilesInputRef.current?.click()}
                              className="aspect-square rounded-xl border-2 border-dashed border-slate-200 hover:border-slate-300 bg-slate-50/50 flex flex-col items-center justify-center gap-1 cursor-pointer transition-all animate-none"
                            >
                              <Plus className="w-4 h-4 text-slate-400" />
                              <span className="text-[10px] font-bold text-slate-500 text-center">Tambah</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Conditional Reference Video */}
                    {/* Model Selector Engine (Meitu AI RoboNeo) */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold uppercase tracking-widest text-slate-400 ml-1">RoboNeo Model Engine (Meitu AI)</label>
                        <span className="text-[10px] font-black uppercase text-blue-600 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-200/60 font-mono">Official Server Models</span>
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <button
                          type="button"
                          onClick={() => setSelectedModel('banana_pro')}
                          className={`flex flex-col text-left p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden ${
                            selectedModel === 'banana_pro'
                              ? 'border-blue-500 bg-blue-50/25 ring-2 ring-blue-500/10'
                              : 'border-slate-200 hover:border-slate-300 bg-white shadow-sm'
                          }`}
                        >
                          <div className="flex items-center justify-between w-full mb-1.5">
                            <span className={`text-xs font-black truncate ${selectedModel === 'banana_pro' ? 'text-blue-700' : 'text-slate-800'}`}>Nano Banana Pro</span>
                            <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${selectedModel === 'banana_pro' ? 'border-blue-500 bg-blue-500 text-white' : 'border-slate-300'}`}>
                              {selectedModel === 'banana_pro' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                            </div>
                          </div>
                          <span className="text-[10px] text-slate-500 leading-relaxed font-semibold">Model andalan untuk hasil foto ultra-realistik dan detail tajam.</span>
                        </button>

                          <button
                            type="button"
                            onClick={() => setSelectedModel('banana_2')}
                            className={`flex flex-col text-left p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden ${
                              selectedModel === 'banana_2'
                                ? 'border-indigo-500 bg-indigo-50/25 ring-2 ring-indigo-500/10'
                                : 'border-slate-200 hover:border-slate-300 bg-white shadow-sm'
                            }`}
                          >
                            <div className="flex items-center justify-between w-full mb-1.5">
                              <span className={`text-xs font-black truncate ${selectedModel === 'banana_2' ? 'text-indigo-700' : 'text-slate-800'}`}>Nano Banana 2</span>
                              <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${selectedModel === 'banana_2' ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-slate-300'}`}>
                                {selectedModel === 'banana_2' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                              </div>
                            </div>
                            <span className="text-[10px] text-slate-500 leading-relaxed font-semibold">Khusus untuk seni gaya anime, lukisan, dan ilustrasi artistik cepat.</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setSelectedModel('gpt_image_2')}
                            className={`flex flex-col text-left p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden ${
                              selectedModel === 'gpt_image_2'
                                ? 'border-emerald-500 bg-emerald-50/25 ring-2 ring-emerald-500/10'
                                : 'border-slate-200 hover:border-slate-300 bg-white shadow-sm'
                            }`}
                          >
                            <div className="flex items-center justify-between w-full mb-1.5">
                              <span className={`text-xs font-black truncate ${selectedModel === 'gpt_image_2' ? 'text-emerald-700' : 'text-slate-800'}`}>GPT Image 2</span>
                              <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${selectedModel === 'gpt_image_2' ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300'}`}>
                                {selectedModel === 'gpt_image_2' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                              </div>
                            </div>
                            <span className="text-[10px] text-slate-500 leading-relaxed font-semibold">Sangat cerdas dalam memahami prompt teks & instruksi modifikasi rumit.</span>
                          </button>
                        </div>

                        {/* Sub Options for Nano Banana Pro (Resolution and Aspect Ratio) */}
                        {selectedModel === 'banana_pro' && (
                          <motion.div 
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="space-y-4 pt-4 border-t border-slate-100 mt-4"
                          >
                            <div className="space-y-2">
                              <label className="text-xs font-bold uppercase tracking-widest text-slate-400 ml-1">Resolusi (Nano Banana Pro)</label>
                              <div className="grid grid-cols-3 gap-2">
                                {(['1K', '2K', '4K'] as const).map((res) => (
                                  <button
                                    key={res}
                                    type="button"
                                    onClick={() => setBananaProResolution(res)}
                                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer text-center ${
                                      bananaProResolution === res
                                        ? 'bg-blue-50 border-blue-500 text-blue-700'
                                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                                    }`}
                                  >
                                    {res} • {res === '4K' ? '46' : '26'} 🥕
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="space-y-2">
                              <label className="text-xs font-bold uppercase tracking-widest text-slate-400 ml-1">Aspect Ratio (Nano Banana Pro)</label>
                              <div className="grid grid-cols-3 gap-2">
                                {([
                                  { value: '1:1', label: '1:1' },
                                  { value: '16:9', label: '16:9 (landscape)' },
                                  { value: '9:16', label: '9:16 (portrait)' }
                                ] as const).map((opt) => (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setAspectRatio(opt.value)}
                                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer text-center ${
                                      aspectRatio === opt.value
                                        ? 'bg-blue-50 border-blue-500 text-blue-700'
                                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                                    }`}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </motion.div>
                        )}

                        {/* Sub Options for GPT Image 2 (Quality and Aspect Ratio) */}
                        {selectedModel === 'gpt_image_2' && (
                          <motion.div 
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="space-y-4 pt-4 border-t border-slate-100 mt-4"
                          >
                            <div className="space-y-2">
                              <label className="text-xs font-bold uppercase tracking-widest text-slate-400 ml-1">Kualitas (GPT Image 2)</label>
                              <div className="grid grid-cols-2 gap-2">
                                {([
                                  { value: 'standard', label: 'Standard', cost: '11' },
                                  { value: 'high', label: 'High', cost: '41' }
                                ] as const).map((qual) => (
                                  <button
                                    key={qual.value}
                                    type="button"
                                    onClick={() => setGptImageQuality(qual.value)}
                                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer text-center ${
                                      gptImageQuality === qual.value
                                        ? 'bg-emerald-50 border-emerald-500 text-emerald-700'
                                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                                    }`}
                                  >
                                    {qual.label} • {qual.cost} 🥕
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="space-y-2">
                              <label className="text-xs font-bold uppercase tracking-widest text-slate-400 ml-1">Aspect Ratio (GPT Image 2)</label>
                              <div className="grid grid-cols-3 gap-2">
                                {([
                                  { value: '1:1', label: '1:1' },
                                  { value: '9:16', label: '9:16 (portrait)' },
                                  { value: '16:9', label: '16:9 (landscape)' }
                                ] as const).map((opt) => (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setAspectRatio(opt.value)}
                                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer text-center ${
                                      aspectRatio === opt.value
                                        ? 'bg-emerald-50 border-emerald-500 text-emerald-700'
                                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                                    }`}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </motion.div>
                        )}

                        {/* General Aspect Ratio for other models like Nano Banana 2 */}
                        {selectedModel === 'banana_2' && (
                          <motion.div 
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="space-y-4 pt-4 border-t border-slate-100 mt-4"
                          >
                            <div className="space-y-2">
                              <label className="text-xs font-bold uppercase tracking-widest text-slate-400 ml-1">Aspect Ratio (Nano Banana 2)</label>
                              <div className="grid grid-cols-3 gap-2">
                                {([
                                  { value: '1:1', label: '1:1' },
                                  { value: '16:9', label: '16:9' },
                                  { value: '9:16', label: '9:16' }
                                ] as const).map((opt) => (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setAspectRatio(opt.value)}
                                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer text-center ${
                                      aspectRatio === opt.value
                                        ? 'bg-indigo-50 border-indigo-500 text-indigo-700'
                                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                                    }`}
                                  >
                                    {opt.value}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-slate-400 ml-1">Generation Prompt</label>
                      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the image modifications or visual style..." className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all min-h-[85px] resize-none" />
                    </div>

                    {error && (
                      <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-3 text-rose-700 text-sm">
                        <AlertCircle className="w-5 h-5 flex-shrink-0" />
                        <p>{error}</p>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isUploading || refFiles.length === 0 || stats.ready === 0}
                      className="w-full h-14 bg-slate-900 text-white rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xl shadow-slate-200 active:scale-[0.98]"
                    >
                      {isUploading ? (
                        <>
                           <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
                           <span>Sedang Memproses ke Server RoboNeo...</span>
                        </>
                      ) : (
                        <>
                           <Send className="w-5 h-5" />
                           <span>{stats.ready === 0 ? `Saldo Carrots Kurang (< ${requiredCarrots} 🥕)` : `Proses ke Server RoboNeo (${requiredCarrots} 🥕)`}</span>
                        </>
                      )}
                    </button>
                    {stats.ready === 0 && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-center">
                        <p className="text-xs text-amber-800 font-bold">
                           ⚠️ Saldo Carrots Tidak Mencukupi (Butuh Akun ≥ {requiredCarrots} 🥕)
                        </p>
                        <p className="text-[11px] text-amber-600 mt-0.5 leading-snug">
                           Akun Anda harus memiliki saldo minimal <strong>{requiredCarrots} 🥕</strong> untuk dapat memulai render. Silakan tambahkan token akun baru dengan saldo cukup di tab <strong>Access Key Pool</strong>.
                        </p>
                      </div>
                    )}
                  </form>
                </section>
              </div>

              {/* Right Column: History */}
              <div className="lg:col-span-7 space-y-6">
                <div className="flex flex-col gap-4 border-b border-slate-200/60 pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 text-slate-400">
                      <History className="w-5 h-5 text-slate-600" />
                      <h2 className="text-lg font-bold text-slate-900">Recent Activity</h2>
                      <button
                        type="button"
                        disabled={isSyncingCloud}
                        onClick={handleSyncCloud}
                        className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-65 hover:bg-slate-200 text-slate-700 rounded-lg text-[10px] font-bold tracking-wider uppercase transition-all border border-slate-200 shadow-2xs disabled:opacity-50 cursor-pointer"
                        title="Sinkronisasi Ulang Hasil Video Dari Cloud RoboNeo"
                      >
                        <RefreshCw className={`w-3 h-3 text-slate-500 ${isSyncingCloud ? 'animate-spin' : ''}`} />
                        {isSyncingCloud ? 'SYNCING...' : 'Sync Cloud'}
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-600 bg-amber-50/80 px-2.5 py-1 rounded-xl border border-amber-200/80 shadow-2xs">
                        <Clock className="w-3 h-3 text-amber-500" />
                        Video Otomatis Dihapus 30 Jam
                      </span>

                      <button
                        type="button"
                        onClick={handleBulkDelete}
                        className="flex items-center gap-1 px-2.5 py-1 bg-rose-50 hover:bg-rose-65 text-rose-600 rounded-xl text-[10px] font-bold uppercase transition-all border border-rose-200 shadow-2xs"
                        title="Hapus semua tugas pada tab ini"
                      >
                        <Trash2 className="w-3 h-3" />
                        Hapus Tab Ini
                      </button>
                    </div>
                  </div>
                  
                  {/* Category Tabs */}
                  <div className="flex items-center gap-1 bg-slate-65 p-1 rounded-2xl border border-slate-200 shadow-inner text-[10px] font-bold uppercase tracking-wider overflow-x-auto">
                    {(['PROCESSING', 'SELESAI', 'INVALID'] as const).map((filter) => {
                      let count = 0;
                      if (filter === 'PROCESSING') count = jobs.filter(j => j.status?.toLowerCase() !== 'completed' && j.status?.toLowerCase() !== 'failed').length;
                      else if (filter === 'SELESAI') count = jobs.filter(j => j.status?.toLowerCase() === 'completed').length;
                      else if (filter === 'INVALID') count = jobs.filter(j => j.status?.toLowerCase() === 'failed').length;

                      return (
                        <button
                          key={filter}
                          type="button"
                          onClick={() => setJobFilter(filter)}
                          className={`px-3 py-1.5 rounded-xl transition-all whitespace-nowrap ${
                            jobFilter === filter 
                              ? 'bg-white text-slate-900 shadow-sm border border-slate-200/30 font-black' 
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          {filter} ({count})
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-4">
                  {jobs.filter(job => {
                    const isCompleted = job.status?.toLowerCase() === 'completed';
                    const isFailed = job.status?.toLowerCase() === 'failed';
                    const isProcessing = !isCompleted && !isFailed;

                    if (jobFilter === 'PROCESSING') return isProcessing;
                    if (jobFilter === 'SELESAI') return isCompleted;
                    if (jobFilter === 'INVALID') return isFailed;
                    return true;
                  }).map((job) => (
                    <div key={job.id} className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[10px] font-mono bg-slate-65 px-1.5 py-0.5 rounded uppercase">{job.id.slice(0, 8)}</span>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{new Date(job.createdAt).toLocaleTimeString()}</span>
                            {job.jobType === 'upscale' && (
                              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-300 flex items-center gap-1 shadow-2xs">
                                <Sparkles className="w-2.5 h-2.5 text-purple-600" />
                                UPSCALE 2K • 1 🥕
                              </span>
                            )}
                            {job.jobType === 'image' && (
                              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200 flex items-center gap-1 shadow-2xs">
                                <ImageIcon className="w-2.5 h-2.5 text-blue-600" />
                                IMAGE • {job.costCarrots ?? 15} 🥕
                              </span>
                            )}
                            {job.selectedModel && (
                              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200/80 flex items-center gap-1">
                                🧠 {job.selectedModel === 'banana_pro' ? 'Nano Banana Pro' : job.selectedModel === 'banana_2' ? 'Nano Banana 2' : 'GPT Image 2'}
                              </span>
                            )}
                            {job.keyId && (
                              <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest border border-blue-65 px-1.5 py-0.5 rounded flex items-center gap-1">
                                <KeyIcon className="w-2.5 h-2.5" />
                                {keys.find(k => k.id === job.keyId)?.key.slice(0, 4)}...
                              </span>
                            )}
                            {(job.resolution?.includes('2K') || job.upscaledArtifact) && (
                              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-65 text-emerald-800 border border-emerald-200 flex items-center gap-1 shadow-2xs">
                                <Sparkles className="w-2.5 h-2.5" />
                                2K ULTRA HD
                              </span>
                            )}
                            {job.resolution && !job.resolution.includes('2K') && !job.resolution.includes('Image-to-Image') && (
                              <span className="text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200/80 px-2 py-0.5 rounded-full uppercase">
                                {job.resolution}
                              </span>
                            )}
                            {job.quality && (
                              <span className="text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200/80 px-2 py-0.5 rounded-full uppercase">
                                {job.quality}
                              </span>
                            )}
                            {job.aspectRatio && (
                              <span className="text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200/80 px-2 py-0.5 rounded-full uppercase">
                                AR {job.aspectRatio}
                              </span>
                            )}
                            {job.parentJobId && (
                              <span className="text-[9px] font-mono text-slate-500 bg-slate-65 px-1.5 py-0.5 rounded border border-slate-200">
                                Ref: {job.parentJobId.slice(0, 8)}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-slate-700">{job.prompt || 'RoboNeo Generation'}</p>
                            {!(job.status?.toLowerCase() === 'completed' || job.status?.toLowerCase() === 'failed') && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] font-black text-amber-600 uppercase bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 animate-pulse flex items-center gap-1">
                                  <Clock className="w-2.5 h-2.5" />
                                  <span>{job.status}</span>
                                </span>
                                <span className="text-[9px] font-bold text-slate-500 bg-slate-65 px-1.5 py-0.5 rounded border border-slate-200">
                                  Maks 12m
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {!(job.status?.toLowerCase() === 'completed' || job.status?.toLowerCase() === 'failed') && (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveGeneratingJobId(job.id);
                                setShowGeneratingModal(true);
                              }}
                              className="px-2.5 py-1 bg-amber-50 hover:bg-amber-65 text-amber-800 border border-amber-200 rounded-full text-[10px] font-black flex items-center gap-1 transition-all shadow-2xs cursor-pointer"
                              title="Buka Pop-up Status Server RoboNeo"
                            >
                              <Zap className="w-3 h-3 text-amber-500 animate-pulse fill-current" />
                              <span>STATUS SERVER</span>
                            </button>
                          )}

                          <div className={`px-3 py-1 rounded-full text-[10px] font-black border flex items-center gap-1.5 shadow-sm ${
                            job.status?.toLowerCase() === 'completed' 
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                              : job.status?.toLowerCase() === 'failed' 
                                ? 'bg-rose-50 text-rose-700 border-rose-200' 
                                : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}>
                            {getStatusIcon(job.status)}
                            <span className="uppercase tracking-wider">
                              {job.status?.toLowerCase() === 'completed' ? 'SELESAI' : job.status?.toLowerCase() === 'failed' ? 'INVALID' : job.status?.toUpperCase() === 'SUBMITTING' ? 'SUBMITTING' : 'PROCESSING'}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleDeleteJob(job.id)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all border border-slate-200/80 hover:border-rose-200 shadow-2xs"
                            title="Hapus tugas dan video ini"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Job specific actions & info */}
                      <div className="flex items-center justify-between pt-2 border-t border-slate-50">
                        <div className="flex items-center gap-4">
                          {job.roomId && (
                            <div className="flex flex-col">
                              <span className="text-[8px] font-bold text-slate-400 uppercase">Room ID</span>
                              <span className="text-[10px] font-mono text-slate-600">{job.roomId}</span>
                            </div>
                          )}
                          <div className="flex flex-col">
                            <span className="text-[8px] font-bold text-slate-400 uppercase">Sequence</span>
                            <span className="text-[10px] font-mono text-slate-600">{job.maxSeq}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {job.status?.toLowerCase() === 'completed' && job.artifacts && job.artifacts.length > 0 && (() => {
                            const videoArtifact = job.artifacts.find(a => /\.(mp4|webm|mov)$/i.test(a));
                            const imageArtifact = job.artifacts.find(a => /\.(jpg|jpeg|png|webp)$/i.test(a));
                            const rawMain = videoArtifact || imageArtifact || job.artifacts[0];
                            const mainArtifact = getMediaUrl(rawMain);
                            const isVideo = Boolean(videoArtifact);
                            const isAlready2K = job.resolution === '2K' || Boolean(job.upscaledArtifact);

                            return (
                              <div className="flex items-center gap-2 flex-wrap justify-end">
                                {isVideo && !isAlready2K && (
                                  <button
                                    type="button"
                                    disabled={isUpscalingManual === job.id}
                                    onClick={() => handleManualUpscale(job.id)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 hover:bg-purple-65 text-purple-700 border border-purple-200 rounded-xl text-[10px] font-bold transition-all shadow-sm cursor-pointer disabled:opacity-50"
                                    title="Upscale video ini ke resolusi 2K Ultra HD"
                                  >
                                    {isUpscalingManual === job.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                                    <span>{isUpscalingManual === job.id ? 'UPSCALE...' : 'UPSCALE 2K'}</span>
                                  </button>
                                )}
                                <a 
                                  href={mainArtifact} 
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 text-white rounded-xl text-[10px] font-bold hover:bg-slate-800 transition-all shadow-sm"
                                >
                                  {isVideo ? 'LIHAT VIDEO' : 'LIHAT HASIL'}
                                </a>
                                <a 
                                  href={mainArtifact} 
                                  download 
                                  className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500 text-white rounded-xl text-[10px] font-bold hover:bg-emerald-600 transition-all shadow-sm"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  {isVideo ? (isAlready2K ? 'DOWNLOAD 2K VIDEO' : 'DOWNLOAD VIDEO') : 'DOWNLOAD HASIL'}
                                </a>
                              </div>
                            );
                          })()}
                          {job.status?.toLowerCase() === 'failed' && (
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                              <div className="flex items-center gap-1.5 text-rose-500 text-[10px] font-bold uppercase bg-rose-50 px-3 py-1.5 rounded-xl border border-rose-65">
                                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                <span>
                                  {job.error === 'RoboNeo history-detail reported done but artifacts list is empty.' || job.error === 'DOWNLOAD SUCCEEDED BUT CREATED NO FILES'
                                    ? 'PROSES SERVER TIMEOUT ATAU RENDER CLOUD BELUM SIAP. SILAKAN TEKAN SYNC CLOUD ATAU COBA GENERATE ULANG.' 
                                    : job.error?.includes('UPLOAD REQUEST FAILED') || job.error?.includes('TIMEOUT')
                                      ? 'KONEKSI UPLOAD SERVER TIMEOUT. SISTEM AKAN ROTASI AKUN AUTOMATIS SAAT GENERATE ULANG.'
                                      : job.error}
                                </span>
                              </div>
                              <button
                                onClick={() => handleRetryJob(job.id)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-[10px] font-bold transition-all shadow-sm shrink-0 cursor-pointer"
                              >
                                <RefreshCw className="w-3 h-3" />
                                COBA LAGI (RETRY)
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Media Preview (Video or Image) */}
                      {job.status?.toLowerCase() === 'completed' && job.artifacts && job.artifacts.length > 0 && (() => {
                        const videoArtifact = job.artifacts.find(a => /\.(mp4|webm|mov)$/i.test(a));
                        const imageArtifact = job.artifacts.find(a => /\.(jpg|jpeg|png|webp)$/i.test(a));
                        const isAlready2K = job.resolution === '2K' || !!job.upscaledArtifact;
                        const cleanVideoUrl = videoArtifact ? getMediaUrl(videoArtifact) : null;
                        const cleanImageUrl = imageArtifact ? getMediaUrl(imageArtifact) : null;
                        const cleanPosterUrl = job.sourceImage ? getMediaUrl(job.sourceImage) : (cleanImageUrl || undefined);

                        if (job.jobType === 'image' && cleanImageUrl) {
                          return (
                            <div className="mt-2 rounded-2xl overflow-hidden border border-slate-65 bg-slate-900 p-2 relative group flex items-center justify-center max-h-[380px]">
                              <img 
                                src={cleanImageUrl} 
                                alt={job.prompt || 'Generated Result'} 
                                className="max-h-[360px] w-auto object-contain rounded-xl shadow-md"
                              />
                            </div>
                          );
                        }

                        if (cleanVideoUrl) {
                          const hasError = videoErrors[job.id];
                          return (
                            <div className="mt-2 rounded-2xl overflow-hidden border border-slate-65 bg-slate-950 relative group flex flex-col items-center justify-center min-h-[220px]">
                              {hasError ? (
                                <div className="p-6 text-center text-slate-300 space-y-3">
                                  <AlertCircle className="w-8 h-8 text-amber-400 mx-auto" />
                                  <p className="text-xs font-semibold">Video sedang disiapkan atau browser membutuhkan refresh.</p>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setVideoErrors(prev => ({ ...prev, [job.id]: false }));
                                    }}
                                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-[10px] font-bold transition-all"
                                  >
                                    Muat Ulang Player
                                  </button>
                                </div>
                              ) : (
                                <video 
                                  key={cleanVideoUrl}
                                  src={`${cleanVideoUrl}#t=0.001`}
                                  poster={cleanPosterUrl}
                                  controls 
                                  playsInline
                                  preload="auto"
                                  className="w-full max-h-[480px] object-contain cursor-pointer"
                                  onError={() => {
                                    setVideoErrors(prev => ({ ...prev, [job.id]: true }));
                                  }}
                                />
                              )}
                              {isAlready2K && !hasError && (
                                <div className="absolute top-3 right-3 bg-purple-950/80 backdrop-blur-md border border-purple-400/50 text-purple-200 text-[10px] font-black px-2.5 py-1 rounded-xl flex items-center gap-1.5 shadow-lg pointer-events-none z-10">
                                  <Sparkles className="w-3 h-3 text-purple-300" />
                                  <span>2K ULTRA HD</span>
                                </div>
                              )}
                            </div>
                          );
                        }

                        if (cleanImageUrl) {
                          return (
                            <div className="mt-2 rounded-2xl overflow-hidden border border-slate-65 bg-slate-900 p-2 relative group flex items-center justify-center max-h-[380px]">
                              <img 
                                src={cleanImageUrl} 
                                alt={job.prompt || 'Generated Result'} 
                                className="max-h-[360px] w-auto object-contain rounded-xl shadow-md"
                              />
                            </div>
                          );
                        }

                        return null;
                      })()}

                      {/* Job Logs */}
                      {job.logs.length > 0 && (
                        <details className="group">
                          <summary className="text-[10px] font-bold text-slate-400 uppercase tracking-widest cursor-pointer hover:text-slate-600 transition-colors list-none flex items-center gap-1">
                            <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
                            Execution Logs
                          </summary>
                          <div className="mt-3 p-4 bg-slate-900 rounded-2xl max-h-40 overflow-y-auto font-mono text-[10px] text-slate-300 space-y-1">
                            {job.logs.map((log, idx) => (
                              <div key={idx} className="border-l border-slate-700 pl-2 py-0.5">
                                <span className="text-slate-500 mr-2">[{idx + 1}]</span>
                                {log}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="pool"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              {/* Stats Bar */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {[
                  { label: 'Total Pool', value: stats.total, icon: KeyIcon, color: 'text-slate-900' },
                  { label: 'Siap Render (≥15 🥕)', value: stats.ready, icon: CheckCircle2, color: 'text-emerald-500' },
                  { label: 'Saldo Menipis (<15 🥕)', value: stats.lowCarrots, icon: Zap, color: 'text-amber-500' },
                  { label: 'Invalid / Expired', value: stats.invalid, icon: XCircle, color: 'text-rose-500' },
                ].map((s, i) => (
                  <div key={i} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                      <s.icon className={`w-5 h-5 ${s.color}`} />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{s.label}</span>
                    </div>
                    <p className="text-3xl font-black">{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Pool Controls */}
              <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">Access Key Pool</h2>
                    <p className="text-slate-500 text-sm">Manage and rotate your RoboNeo authentication tokens.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="relative group">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                      <input 
                        type="text" 
                        placeholder="Search keys..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-blue-500/10 outline-none w-48 lg:w-64 transition-all"
                      />
                    </div>
                    
                    <button 
                      onClick={handleSyncAllCarrots}
                      disabled={isSyncingAllCarrots || keys.some(k => k.status === 'Validating')}
                      className="h-12 px-5 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white rounded-2xl font-bold text-sm flex items-center gap-2 transition-all shadow-lg shadow-amber-65 cursor-pointer disabled:cursor-not-allowed"
                      title="Sinkronisasi Saldo Carrot Semua Akun"
                    >
                      <RefreshCw className={`w-4 h-4 ${(isSyncingAllCarrots || keys.some(k => k.status === 'Validating')) ? 'animate-spin' : ''}`} />
                      Sync Saldo Carrot
                    </button>

                    <button 
                      onClick={handleDeleteAllKeys}
                      disabled={keys.length === 0}
                      className="h-12 px-5 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300 text-white rounded-2xl font-bold text-sm flex items-center gap-2 transition-all shadow-lg shadow-rose-65 cursor-pointer disabled:cursor-not-allowed"
                      title="Hapus Semua Akun dari Pool"
                    >
                      <Trash2 className="w-4 h-4" />
                      Hapus Semua
                    </button>

                    <button 
                      onClick={openAddModal}
                      className="h-12 px-6 bg-slate-900 text-white rounded-2xl font-bold text-sm flex items-center gap-2 hover:bg-slate-800 transition-all shadow-lg shadow-slate-200"
                    >
                      <Plus className="w-4 h-4" />
                      Add Accounts
                    </button>
                  </div>
                </div>

                <div className="overflow-hidden rounded-[32px] border border-slate-65 bg-white shadow-sm">
                  <div className="divide-y divide-slate-50">
                    {filteredKeys.length === 0 ? (
                      <div className="px-6 py-20 text-center">
                        <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-300 mx-auto mb-4">
                          <KeyIcon className="w-8 h-8" />
                        </div>
                        <p className="text-slate-400 font-medium italic">No access keys found in the pool.</p>
                      </div>
                    ) : (
                      filteredKeys.map((k) => (
                        <div key={k.id} className="group px-8 py-4 flex items-center justify-between hover:bg-slate-50/50 transition-all">
                          <div className="flex items-center gap-6 flex-1">
                            {/* Key Icon */}
                            <div className="w-12 h-12 rounded-2xl bg-slate-65 flex items-center justify-center text-slate-400 group-hover:text-slate-900 transition-all">
                              <KeyIcon className="w-5 h-5" />
                            </div>
                            
                            {/* Key Display */}
                            <div className="flex flex-col">
                              <div className="flex items-center flex-wrap gap-2.5">
                                <code className="text-sm font-mono text-slate-600 bg-slate-50 px-3 py-1 rounded-xl border border-slate-200">
                                  {k.key.slice(0, 12)}...{k.key.slice(-4)}
                                </code>
                                <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">{k.usageCount} Jobs</span>
                                {k.carrots !== undefined && (
                                  <span className="text-[10px] font-black text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg flex items-center gap-1 shadow-sm">
                                    🥕 {k.carrots} Carrots
                                  </span>
                                )}
                                {k.nickname && (
                                  <span className="text-[10px] font-bold text-slate-400 bg-slate-65 px-2 py-0.5 rounded-lg border border-slate-200/40">
                                    @{k.nickname}
                                  </span>
                                )}
                                
                                <button 
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    try {
                                      await fetch(getApiUrl(`/api/keys/${k.id}/validate`), { method: 'POST' });
                                    } catch (err) {}
                                  }}
                                  disabled={k.status === 'Validating'}
                                  className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-blue-500 transition-all disabled:opacity-30"
                                  title="Cek Saldo Sekarang"
                                >
                                  <RefreshCw className={`w-3.5 h-3.5 ${k.status === 'Validating' ? 'animate-spin' : ''}`} />
                                </button>
                              </div>
                              {k.error && k.status === 'Invalid' && (
                                <span className="text-[10px] text-rose-400 font-medium mt-1 truncate max-w-xs">{k.error}</span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-6">
                            {/* Status Pill */}
                            <div className={`px-4 py-2 rounded-full text-[10px] font-black border flex items-center gap-2 uppercase tracking-widest shadow-sm ${
                              k.status === 'Validating' 
                                ? 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse'
                                : k.status === 'Ready' && (k.carrots === undefined || k.carrots >= 46)
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : k.status === 'Ready' && k.carrots < 46
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}>
                              {k.status === 'Validating' ? (
                                <>
                                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                  VALIDATING
                                </>
                              ) : k.status === 'Ready' && (k.carrots === undefined || k.carrots >= 46) ? (
                                <>
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  SIAP RENDER
                                </>
                              ) : k.status === 'Ready' && k.carrots < 46 ? (
                                <>
                                  <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                                  LOW 🥕 (BUTUH ≥46)
                                </>
                              ) : (
                                <>
                                  <XCircle className="w-3.5 h-3.5" />
                                  INVALID
                                </>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-65 transition-opacity">
                              <button 
                                onClick={() => validateKey(k.id)}
                                className="p-2.5 hover:bg-blue-50 text-slate-400 hover:text-blue-500 rounded-xl transition-all"
                                title="Validate Key"
                              >
                                <RefreshCw className={`w-4 h-4 ${k.status === 'Validating' ? 'animate-spin' : ''}`} />
                              </button>
                              <button 
                                onClick={() => deleteKey(k.id)}
                                className="p-2.5 hover:bg-rose-50 text-slate-400 hover:text-rose-500 rounded-xl transition-all"
                                title="Delete Key"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showAddModal && (
            <div className="fixed inset-0 z-[65] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white w-full max-w-2xl rounded-[32px] overflow-hidden shadow-2xl"
              >
                {/* Header Section */}
                <div className="p-8 border-b border-slate-65">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-blue-500">ACCOUNT POOL</span>
                    <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-slate-65 rounded-full transition-colors">
                      <XCircle className="w-6 h-6 text-slate-400" />
                    </button>
                  </div>
                  <h3 className="text-2xl font-bold text-slate-900">Tambah Akun RoboNeo</h3>
                </div>

                <div className="p-8 space-y-8">
                  {addModalError && (
                    <div className="p-4 bg-rose-50 border border-rose-65 rounded-2xl text-rose-600 text-xs font-semibold flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                      {addModalError}
                    </div>
                  )}

                  {/* Mode Switcher */}
                  <div className="flex items-center gap-4 border-b border-slate-65 pb-4">
                    <button 
                      onClick={() => setAddMode('single')}
                      className={`text-sm font-bold pb-2 border-b-2 transition-all ${addMode === 'single' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
                    >
                      Satu key
                    </button>
                    <div className="w-[1px] h-4 bg-slate-200" />
                    <button 
                      onClick={() => setAddMode('bulk')}
                      className={`text-sm font-bold pb-2 border-b-2 transition-all ${addMode === 'bulk' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
                    >
                      Bulk
                    </button>
                  </div>

                  {/* Drop Zone (Only for Bulk) */}
                  {addMode === 'bulk' && (
                    <div 
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={handleFileDrop}
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = '.txt';
                        input.onchange = (e: any) => {
                          const file = e.target.files[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = (re) => setBulkInput(re.target?.result as string);
                            reader.readAsText(file);
                          }
                        };
                        input.click();
                      }}
                      className="group relative h-32 rounded-3xl border-2 border-dashed border-slate-200 hover:border-blue-500 bg-slate-50/50 hover:bg-blue-50/30 transition-all cursor-pointer flex flex-col items-center justify-center gap-2"
                    >
                      <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-slate-400 group-hover:text-blue-500 shadow-sm border border-slate-65 transition-colors">
                        <FileText className="w-5 h-5" />
                      </div>
                      <p className="text-sm font-medium text-slate-600">
                        Tarik file .txt ke sini <span className="text-slate-400 font-normal">atau klik untuk pilih · satu access key per baris</span>
                      </p>
                    </div>
                  )}

                  {/* Input Area */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-widest text-slate-400">
                        {addMode === 'single' ? 'Satu access key' : 'Banyak access key sekaligus'}
                      </label>
                      <span className="text-[10px] text-slate-400 font-medium">
                        {addMode === 'bulk' ? 'Isi file ditambahkan ke kotak di bawah; bisa diedit dulu sebelum disimpan.' : ''}
                      </span>
                    </div>
                    <textarea 
                      value={bulkInput}
                      onChange={(e) => setBulkInput(e.target.value)}
                      placeholder={addMode === 'single' ? '_v2xxxxxxxxxxxxxxxx' : 'Tempel banyak key di sini... (Pisahkan dengan baris baru atau koma)'}
                      className="w-full h-40 bg-slate-50 border border-slate-200 rounded-2xl p-6 text-xs font-mono focus:ring-2 focus:ring-blue-500/10 outline-none transition-all resize-none"
                    />
                  </div>

                  {/* Info Footer */}
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-65 text-[11px] text-slate-500 leading-relaxed italic">
                    Satu access key RoboNeo (_v2...) per baris. Saldo carrots dicek otomatis. Key duplikat atau yang sudah dipakai user lain akan dilewati.
                  </div>
                </div>

                <div className="p-8 bg-slate-50/50 border-t border-slate-65 flex items-center gap-4">
                  <button 
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 h-14 bg-white border border-slate-200 text-slate-600 rounded-2xl font-bold hover:bg-slate-50 transition-all active:scale-[0.98]"
                  >
                    Batal
                  </button>
                  <button 
                    onClick={handleAddKeys}
                    disabled={isAddingKeys || !bulkInput.trim()}
                    className="flex-[2] h-14 bg-slate-900 text-white rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-slate-800 disabled:opacity-50 transition-all shadow-xl shadow-slate-200 active:scale-[0.98]"
                  >
                    {isAddingKeys ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                      <>
                        <Plus className="w-5 h-5" />
                        <span>Tambah Semua</span>
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Modal Confirm Delete All Keys */}
        <AnimatePresence>
          {showDeleteAllKeysModal && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-slate-65"
              >
                <div className="w-14 h-14 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mb-6">
                  <AlertTriangle className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Hapus Semua Akun dari Pool?</h3>
                <p className="text-slate-500 text-sm leading-relaxed mb-8">
                  Apakah Anda yakin ingin menghapus seluruh <span className="font-bold text-slate-800">{keys.length} akun</span> dari access key pool? Semua data akun akan dikosongkan secara permanen.
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowDeleteAllKeysModal(false)}
                    disabled={isDeletingAllKeys}
                    className="flex-1 h-12 bg-slate-65 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-sm transition-all cursor-pointer disabled:opacity-50"
                  >
                    Batal
                  </button>
                  <button
                    onClick={executeDeleteAllKeys}
                    disabled={isDeletingAllKeys}
                    className="flex-1 h-12 bg-rose-600 hover:bg-rose-700 text-white rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-rose-200 cursor-pointer disabled:opacity-50"
                  >
                    {isDeletingAllKeys ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        <span>Ya, Hapus {keys.length} Akun</span>
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Modal Confirm Delete Jobs */}
        <AnimatePresence>
          {showDeleteJobsModal && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-slate-65"
              >
                <div className="w-14 h-14 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mb-6">
                  <AlertTriangle className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">
                  Hapus Semua Tugas di Tab {jobFilter}?
                </h3>
                <p className="text-slate-500 text-sm leading-relaxed mb-8">
                  Apakah Anda yakin ingin menghapus semua tugas di tab <span className="font-bold text-slate-800">{jobFilter}</span>? Video dan log riwayat terkait akan dihapus secara permanen dari server.
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowDeleteJobsModal(false)}
                    disabled={isDeletingJobs}
                    className="flex-1 h-12 bg-slate-65 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-sm transition-all cursor-pointer disabled:opacity-50"
                  >
                    Batal
                  </button>
                  <button
                    onClick={executeBulkDeleteJobs}
                    disabled={isDeletingJobs}
                    className="flex-1 h-12 bg-rose-600 hover:bg-rose-700 text-white rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-rose-200 cursor-pointer disabled:opacity-50"
                  >
                    {isDeletingJobs ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        <span>Ya, Hapus Semua</span>
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Modal Pop-Up "Sedang Memproses ke Server RoboNeo" */}
        <AnimatePresence>
          {showGeneratingModal && (
            <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-md z-50 flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="bg-white rounded-3xl max-w-lg w-full shadow-2xl border border-slate-65 overflow-hidden"
              >
                {/* Animated Top Header */}
                <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 p-6 text-white relative overflow-hidden">
                  <div className="absolute -right-6 -bottom-6 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />
                  <div className="flex items-center gap-4 relative z-10">
                    <div className="w-12 h-12 bg-amber-400/20 border border-amber-400/30 rounded-2xl flex items-center justify-center text-amber-400 shrink-0 shadow-lg">
                      <Zap className="w-6 h-6 fill-current animate-pulse" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
                        <h3 className="text-lg font-black tracking-tight text-white">
                          Sedang Memproses ke Server RoboNeo
                        </h3>
                      </div>
                      <p className="text-xs text-slate-300 font-medium mt-0.5">
                        {uploadProgressText || 'Permintaan AI Generation sedang dikirim secara langsung ke GPU cluster RoboNeo.'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Modal Body / Progress Content */}
                <div className="p-6 space-y-6">
                  {/* Active Job State Card */}
                  {(() => {
                    const activeJob = jobs.find(j => j.id === activeGeneratingJobId);
                    const isCompleted = activeJob?.status?.toLowerCase() === 'completed';
                    const isFailed = activeJob?.status?.toLowerCase() === 'failed';

                    return (
                      <div className="space-y-4">
                        {/* Status Indicator Banner */}
                        <div className={`p-4 rounded-2xl border flex items-center justify-between gap-3 ${
                          isCompleted 
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : isFailed
                              ? 'bg-rose-50 border-rose-200 text-rose-800'
                              : 'bg-amber-50/90 border-amber-200 text-amber-900'
                        }`}>
                          <div className="flex items-center gap-3">
                            {isCompleted ? (
                              <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                            ) : isFailed ? (
                              <XCircle className="w-6 h-6 text-rose-600 shrink-0" />
                            ) : (
                              <Loader2 className="w-6 h-6 text-amber-600 animate-spin shrink-0" />
                            )}
                            <div>
                              <div className="text-xs font-black uppercase tracking-wider">
                                {isCompleted ? 'PERMINTAAN SELESAI' : isFailed ? 'GAGAL MEMPROSES' : 'SEDANG MEMPROSES KE SERVER ROBONEO...'}
                              </div>
                              <div className="text-[11px] font-semibold text-slate-600 mt-0.5">
                                {activeJob ? (
                                  activeJob.status === 'PREPROCESSING' ? 'Mengompres & memotong video ke 9 detik...' :
                                  activeJob.status === 'ACCOUNT_SELECTING' ? 'Memilih akun aktif dari Account Pool...' :
                                  activeJob.status === 'Creating Room' ? 'Membuat room percakapan AI di RoboNeo...' :
                                  activeJob.status === 'Uploading' || activeJob.status === 'SUBMITTING' ? 'Mengirim prompt & media ke server RoboNeo...' :
                                  activeJob.status === 'ROBO_NEO_PROCESSING' || activeJob.status === 'Processing' ? 'Render AI di GPU RoboNeo Cloud...' :
                                  activeJob.status === 'Downloading' ? 'Mengunduh hasil video dari server...' :
                                  activeJob.status
                                ) : 'Mempersiapkan pengiriman data ke backend server...'}
                              </div>
                            </div>
                          </div>

                          {activeJob && (
                            <span className="text-[10px] font-mono px-2 py-1 bg-white/80 rounded-lg border border-slate-200 font-bold shrink-0">
                              ID: {activeJob.id.slice(0, 8)}
                            </span>
                          )}
                        </div>

                        {/* Steps Visual Tracker */}
                        <div className="space-y-2.5 bg-slate-50 border border-slate-200/80 rounded-2xl p-4 text-xs font-semibold">
                          <div className="flex items-center gap-3 text-slate-700">
                            <span className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[10px] font-bold">✓</span>
                            <span>1. Berkas media diunggah ke server</span>
                          </div>

                          <div className={`flex items-center gap-3 ${
                            activeJob && activeJob.keyId ? 'text-slate-700' : 'text-slate-400'
                          }`}>
                            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                              activeJob && activeJob.keyId ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'
                            }`}>
                              {activeJob && activeJob.keyId ? '✓' : '2'}
                            </span>
                            <span>2. Alokasi Akun Pool RoboNeo (Saldo ≥{requiredCarrots} 🥕)</span>
                          </div>

                          <div className={`flex items-center gap-3 ${
                            activeJob && activeJob.roomId ? 'text-slate-700' : 'text-slate-400'
                          }`}>
                            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                              activeJob && activeJob.roomId ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white animate-pulse'
                            }`}>
                              {activeJob && activeJob.roomId ? '✓' : '3'}
                            </span>
                            <span>3. Terhubung ke GPU Cluster Server RoboNeo</span>
                          </div>
                        </div>

                        {/* Live Backend Logs Terminal */}
                        {activeJob && activeJob.logs && activeJob.logs.length > 0 && (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-slate-400 px-1">
                              <span>Live Logs Server RoboNeo</span>
                              <span className="text-emerald-600 font-mono">ONLINE</span>
                            </div>
                            <div className="bg-slate-900 text-emerald-400 font-mono text-[10px] p-3 rounded-xl max-h-32 overflow-y-auto space-y-1 shadow-inner leading-relaxed border border-slate-800">
                              {activeJob.logs.slice(-6).map((log, i) => (
                                <div key={i} className="truncate">{log}</div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Modal Actions Footer */}
                <div className="p-6 bg-slate-50 border-t border-slate-65 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowGeneratingModal(false)}
                    className="flex-1 h-12 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl font-bold text-xs transition-all shadow-md active:scale-[0.98] cursor-pointer"
                  >
                    Tutup Pop-up (Jalan di Background)
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

      </main>

      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-slate-200 mt-12">
        <div className="flex items-center justify-between text-slate-400">
          <p className="text-xs font-medium uppercase tracking-widest">&copy; 2026 RoboNeo Professional Systems</p>
          <div className="flex items-center gap-6 text-[10px] font-bold uppercase tracking-widest">
            <span className="hover:text-slate-900 cursor-pointer transition-colors">Documentation</span>
            <span className="hover:text-slate-900 cursor-pointer transition-colors">Support</span>
            <span className="hover:text-slate-900 cursor-pointer transition-colors">Legal</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

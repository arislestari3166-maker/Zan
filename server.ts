import express from 'express';
import path from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { spawn, execSync } from 'child_process';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { Job, JobStatus, PollResponse, AccessKey, KeyStatus } from './src/types.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Centralized CORS configuration to allow seamless connection from Preview & Public URLs
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

// Persistent & temporary directory layout
const DIRS = {
  uploads: path.join(process.cwd(), 'uploads'),
  downloads: path.join(process.cwd(), 'downloads'),
  outputs: path.join(process.cwd(), 'outputs'),
  jobsOutput: path.join(process.cwd(), 'outputs', 'jobs'),
  storageMediaImages: path.join(process.cwd(), 'storage', 'media', 'images'),
  storageMediaVideos: path.join(process.cwd(), 'storage', 'media', 'videos'),
  storageMediaProcessed: path.join(process.cwd(), 'storage', 'media', 'processed'),
};

Object.values(DIRS).forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Storage configuration for temporary multer uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${uuidv4()}-${safeName}`);
  }
});

const upload = multer({ storage });

// Database files
const keysFile = path.join(process.cwd(), 'keys.json');
const jobsFile = path.join(process.cwd(), 'jobs.json');
const accessCodesFile = path.join(process.cwd(), 'access_codes.json');

export interface AccessCodeEntry {
  id: string;
  userLabel: string;
  code: string;
  status: 'active' | 'inactive';
  createdAt: number;
  lastUsedAt: number | null;
  userApiKey?: string | null;
}

let keys = new Map<string, AccessKey>();
let isSyncingCarrots = false;
const jobs = new Map<string, Job>();
let accessCodes = new Map<string, AccessCodeEntry>();

// In-memory sessions
const userSessions = new Map<string, { codeId: string; userLabel: string; code: string }>();
const adminSessions = new Set<string>();

// Concurrency Controls
const MAX_CONCURRENT_PARALLEL_JOBS = 10;
const MAX_CONCURRENT_SUBMISSIONS = 10;
const activeSubmissionJobIds = new Set<string>();
let isSubmissionWorkerRunning = false;
let isPollingWorkerRunning = false;

// 30 hours retention in milliseconds
const EXPIRATION_MS = 30 * 60 * 60 * 1000;

// Mutex to space chat submission streams safely
class AsyncMutex {
  private queue: (() => void)[] = [];
  private locked: boolean = false;

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const run = () => {
        this.locked = true;
        resolve(() => {
          this.locked = false;
          const next = this.queue.shift();
          if (next) {
            setTimeout(next, 2000);
          }
        });
      };

      if (!this.locked) {
        run();
      } else {
        this.queue.push(run);
      }
    });
  }
}

const chatSubmissionMutex = new AsyncMutex();

// ==========================================
// UTILITY & PATH HELPERS
// ==========================================

function maskApiKey(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.length <= 8) return '●●●●●●●●';
  return key.slice(0, 4) + '...' + key.slice(-4);
}

function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 10) return '***';
  return `${key.slice(0, 5)}...${key.slice(-4)}`;
}

function getAuthToken(req: express.Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  return null;
}

function toWebPath(filePath: string): string {
  if (!filePath) return filePath;
  const norm = filePath.replace(/\\/g, '/');
  const idx = norm.indexOf('/outputs/');
  if (idx !== -1) {
    return norm.slice(idx);
  }
  if (norm.startsWith('outputs/')) {
    return '/' + norm;
  }
  return norm.startsWith('/') ? norm : `/${norm}`;
}

function toLocalPath(webOrLocalPath: string): string {
  if (!webOrLocalPath) return webOrLocalPath;
  const norm = webOrLocalPath.replace(/\\/g, '/');
  const idx = norm.indexOf('/outputs/');
  if (idx !== -1) {
    return path.join(process.cwd(), norm.slice(idx + 1));
  }
  if (norm.startsWith('outputs/')) {
    return path.join(process.cwd(), norm);
  }
  return path.resolve(process.cwd(), norm.replace(/^\//, ''));
}

function calculateFileChecksum(filePath: string): string {
  try {
    if (!fs.existsSync(filePath)) return '';
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
  } catch (e) {
    return '';
  }
}

function logStatus(jobId: string, status: string, details?: any) {
  const job = jobs.get(jobId);
  const roomIdStr = job?.roomId ? `[ROOM_ID: ${job.roomId}]` : '[ROOM_ID: NONE]';
  const msg = `[${new Date().toISOString()}] [JOB_ID: ${jobId.slice(0, 8)}] ${roomIdStr} ${status} ${details !== undefined ? (typeof details === 'string' ? details : JSON.stringify(details)) : ''}`;
  console.log(msg);
  if (job) {
    if (!job.logs) job.logs = [];
    job.logs.push(msg);
    saveJobs();
  }
}

// ==========================================
// PERSISTENT DATA ACCESS
// ==========================================

function loadAccessCodes() {
  if (fs.existsSync(accessCodesFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(accessCodesFile, 'utf8'));
      accessCodes = new Map(Object.entries(data));
    } catch (e) {
      console.error('Failed to load access codes', e);
    }
  }
  if (accessCodes.size === 0) {
    const defaultEntry: AccessCodeEntry = {
      id: uuidv4(),
      userLabel: 'User 001',
      code: 'RBN-4821-X7K9',
      status: 'active',
      createdAt: Date.now(),
      lastUsedAt: null,
      userApiKey: null
    };
    accessCodes.set(defaultEntry.id, defaultEntry);
    saveAccessCodes();
  }
  syncUserApiKeysToPool();
}

function saveAccessCodes() {
  try {
    fs.writeFileSync(accessCodesFile, JSON.stringify(Object.fromEntries(accessCodes), null, 2));
  } catch (e) {
    console.error('Failed to save access codes:', e);
  }
}

function generateCodeString(): string {
  const digits = Math.floor(1000 + Math.random() * 9000).toString();
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let alpha = '';
  for (let i = 0; i < 4; i++) {
    alpha += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `RBN-${digits}-${alpha}`;
}

function getNextUserLabel(): string {
  let maxNum = 0;
  for (const entry of Array.from(accessCodes.values())) {
    const match = entry.userLabel.match(/User\s+(\d+)/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }
  const nextNum = maxNum + 1;
  const padded = nextNum < 65 ? String(nextNum).padStart(3, '0') : String(nextNum);
  return `User ${padded}`;
}

function syncUserApiKeysToPool() {
  for (const entry of Array.from(accessCodes.values())) {
    if (entry.userApiKey) {
      const keyId = `usr-key-${entry.id}`;
      keys.set(keyId, {
        id: keyId,
        key: entry.userApiKey,
        status: 'Ready',
        lastChecked: Date.now(),
        usageCount: 0,
        logs: [],
        nickname: entry.userLabel,
        carrots: 65
      });
    }
  }
  saveKeys();
}

function loadKeys() {
  if (fs.existsSync(keysFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
      keys = new Map(Object.entries(data));
      // Reset validating/busy status to Ready on startup
      keys.forEach(k => {
        if (k.status === 'Validating' || k.status === 'Busy' || k.status === 'Reserved') {
          k.status = 'Ready';
        }
      });
    } catch (e) {
      console.error('Failed to load keys', e);
    }
  }

  // If pool is empty, initialize with default active account pool
  if (keys.size === 0) {
    const defaultAccountsPath = path.join(process.cwd(), 'default_accounts.json');
    if (fs.existsSync(defaultAccountsPath)) {
      try {
        const defaultAccounts = JSON.parse(fs.readFileSync(defaultAccountsPath, 'utf8'));
        defaultAccounts.forEach((acc: any) => {
          keys.set(acc.id, acc);
        });
      } catch (e) {
        console.error('Failed to load default_accounts.json', e);
      }
    }
  }

  // If env ROBONEO_ACCESS_KEY exists and not in pool, add it
  const envKey = process.env.ROBONEO_ACCESS_KEY;
  if (envKey && !Array.from(keys.values()).some(k => k.key === envKey)) {
    const envKeyId = 'env-key';
    keys.set(envKeyId, {
      id: envKeyId,
      key: envKey,
      status: 'Ready',
      lastChecked: Date.now(),
      usageCount: 0,
      logs: [],
      nickname: 'User_1282408686',
      carrots: 12
    });
  }

  saveKeys();
}

function saveKeys() {
  try {
    fs.writeFileSync(keysFile, JSON.stringify(Object.fromEntries(keys), null, 2));
  } catch (e) {
    console.error('Failed to save keys.json:', e);
  }
}

function loadJobs() {
  if (fs.existsSync(jobsFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
      Object.entries(data).forEach(([id, job]: [string, any]) => {
        if (Array.isArray(job.artifacts)) {
          job.artifacts = job.artifacts.map((a: string) => toWebPath(a));
        }
        if (job.upscaledArtifact) {
          job.upscaledArtifact = toWebPath(job.upscaledArtifact);
        }
        jobs.set(id, job);
      });
      console.log(`[JOBS] Loaded ${jobs.size} persisted jobs from jobs.json`);
    } catch (e) {
      console.error('Failed to load jobs.json:', e);
    }
  }
}

function saveJobs() {
  try {
    fs.writeFileSync(jobsFile, JSON.stringify(Object.fromEntries(jobs), null, 2));
  } catch (e) {
    console.error('Failed to save jobs.json:', e);
  }
}

function deleteJobById(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job) return false;

  const folderId = job.roomId || job.id;
  if (folderId) {
    const folderPath = path.join(DIRS.jobsOutput, folderId);
    if (fs.existsSync(folderPath)) {
      try {
        fs.rmSync(folderPath, { recursive: true, force: true });
      } catch (e) {
        console.error(`[DELETE] Failed to remove folder ${folderPath}:`, e);
      }
    }
  }

  // Delete downloads folder
  const downloadDir = path.join('downloads', jobId);
  if (fs.existsSync(downloadDir)) {
    try { fs.rmSync(downloadDir, { recursive: true, force: true }); } catch (e) {}
  }

  // Delete persistent storage media if orphaned
  if (job.imageStoragePath && fs.existsSync(job.imageStoragePath)) {
    try { fs.unlinkSync(job.imageStoragePath); } catch (e) {}
  }
  if (job.processedImagePath && fs.existsSync(job.processedImagePath)) {
    try { fs.unlinkSync(job.processedImagePath); } catch (e) {}
  }

  jobs.delete(jobId);
  saveJobs();
  return true;
}

function cleanExpiredJobs() {
  const now = Date.now();
  let deletedCount = 0;

  for (const [id, job] of Array.from(jobs.entries())) {
    let createdTime = typeof job.createdAt === 'number' ? job.createdAt : new Date(job.createdAt).getTime();
    if (isNaN(createdTime)) {
      createdTime = now;
    }

    if (now - createdTime > EXPIRATION_MS) {
      if (deleteJobById(id)) {
        deletedCount++;
      }
    }
  }

  if (deletedCount > 0) {
    console.log(`[AUTO-CLEANUP] Deleted ${deletedCount} jobs older than 30 hours.`);
  }
}

// 15-minute periodic auto cleanup
setInterval(cleanExpiredJobs, 15 * 60 * 1000);

loadKeys();
loadAccessCodes();
loadJobs();
cleanExpiredJobs();

// ==========================================
// CLI & ERROR CLASSIFICATION
// ==========================================

function getCLICommand(): { cmd: string; argsPrefix: string[] } {
  const localBin = path.join(process.cwd(), 'node_modules', '.bin', 'roboneo');
  if (fs.existsSync(localBin)) {
    return { cmd: localBin, argsPrefix: [] };
  }
  try {
    execSync('roboneo --version', { stdio: 'ignore' });
    return { cmd: 'roboneo', argsPrefix: [] };
  } catch (e) {
    throw new Error('ROBO NEO CLI NOT AVAILABLE');
  }
}

function isTransientError(errorStr: string): boolean {
  if (!errorStr) return false;
  const err = errorStr.toLowerCase();
  return (
    err.includes('timeout') ||
    err.includes('timed out') ||
    err.includes('network') ||
    err.includes('tls/dns') ||
    err.includes('busy') ||
    err.includes('6003') ||
    err.includes('5001') ||
    err.includes('5002') ||
    err.includes('socket') ||
    err.includes('econn') ||
    err.includes('enotfound') ||
    err.includes('headers timeout') ||
    err.includes('fetch failed') ||
    err.includes('system error') ||
    err.includes('rate limit') ||
    err.includes('internal server error')
  );
}

function runCLI(args: string[], key: string, env: any = {}, timeoutMs: number = 360000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let cmdInfo;
    try {
      cmdInfo = getCLICommand();
    } catch (e: any) {
      return resolve({ code: 1, stdout: '', stderr: e.message });
    }

    const child = spawn(cmdInfo.cmd, [...cmdInfo.argsPrefix, ...args], {
      env: { ...process.env, ...env, ROBONEO_ACCESS_KEY: key }
    });

    if (child.stdin) {
      child.stdin.end();
    }

    let stdout = '';
    let stderr = '';
    let isFinished = false;

    const timeout = setTimeout(() => {
      if (isFinished) return;
      isFinished = true;
      try {
        child.kill('SIGKILL');
      } catch (e) {
        console.error('Failed to kill hung process:', e);
      }
      resolve({ 
        code: 1999, 
        stdout, 
        stderr: stderr + '\n[ERROR] CLI Execution Timeout: Process exceeded ' + (timeoutMs / 1000) + 's.' 
      });
    }, timeoutMs);

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('error', (err) => {
      if (isFinished) return;
      isFinished = true;
      clearTimeout(timeout);
      resolve({ code: 1, stdout: '', stderr: `CLI Spawn error: ${err.message}` });
    });

    child.on('close', (code) => {
      if (isFinished) return;
      isFinished = true;
      clearTimeout(timeout);
      resolve({ code: code || 0, stdout, stderr });
    });
  });
}

function parseCLIJsonOutput(rawStr: string): any {
  if (!rawStr) return {};
  const str = rawStr.trim();
  try {
    return JSON.parse(str);
  } catch (e) {}

  const lines = str.split('\n').map(l => l.trim()).filter(Boolean);
  let aggregated: any = {};
  for (const line of lines) {
    const match = line.match(/\{[\s\S]*\}/)?.[0];
    if (match) {
      try {
        const parsed = JSON.parse(match);
        if (parsed && typeof parsed === 'object') {
          aggregated = { ...aggregated, ...parsed };
          if (parsed.artifacts || parsed.media_items || parsed.error_code || parsed.code || parsed.room_id) {
            return parsed;
          }
        }
      } catch (e) {}
    }
  }

  try {
    const match = str.match(/\{[\s\S]*\}/)?.[0];
    if (match) return JSON.parse(match);
  } catch (e) {}

  return aggregated;
}

function extractErrorDetail(result: { stdout: string; stderr: string }): string {
  if (!result) return 'Unknown error (empty result)';
  let err = (result.stderr || '').trim();
  const stdoutTrim = (result.stdout || '').trim();
  
  if (!err || err === 'none' || err === 'null') {
    err = stdoutTrim;
  }
  
  if (!err) {
    return 'Execution failed without error output';
  }
  
  try {
    const jsonStr = err.match(/\{[\s\S]*\}/)?.[0] || err;
    const parsed = JSON.parse(jsonStr);
    return parsed.error_msg || parsed.message || parsed.detail || err;
  } catch (e) {
    return err;
  }
}

// Validate Key against RoboNeo API
async function validateKey(key: string): Promise<{ valid: boolean; nickname?: string; carrots?: number; error?: string; isTransient?: boolean }> {
  return new Promise((resolve) => {
    let cmdInfo;
    try {
      cmdInfo = getCLICommand();
    } catch (e: any) {
      resolve({ valid: false, error: e.message, isTransient: false });
      return;
    }

    const child = spawn(cmdInfo.cmd, [...cmdInfo.argsPrefix, 'user-info'], {
      env: { ...process.env, ROBONEO_ACCESS_KEY: key }
    });

    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ valid: false, error: 'Validation timed out after 20 seconds (Server RoboNeo mungkin sibuk)', isTransient: true });
    }, 20000);

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ valid: false, error: `CLI tidak bisa dijalankan: ${err.message}`, isTransient: false });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      
      const combinedOutput = (stdout + '\n' + stderr).trim();
      
      if (code === 0) {
        try {
          const jsonStr = stdout.match(/\{[\s\S]*\}/)?.[0] || stdout;
          const data = JSON.parse(jsonStr);
          let carrots = 0;
          
          // Parse complex balance structure from CLI
          if (Array.isArray(data.detail_list)) {
            for (const d of data.detail_list) {
              if (Array.isArray(d.meiye_balance_list)) {
                for (const b of d.meiye_balance_list) {
                  const val = parseInt(b.left_info, 10);
                  if (!isNaN(val)) carrots += val;
                }
              }
            }
          } else if (typeof data.carrots === 'number') {
            carrots = data.carrots;
          } else if (typeof data.total_amount === 'number') {
            carrots = data.total_amount;
          }

          const nickname = data.nickname || (data.uid ? `User_${data.uid}` : 'RoboNeo User');
          resolve({ valid: true, nickname, carrots });
        } catch (e) {
          // If parse fails but code was 0, it might be a partial success or different format
          resolve({ valid: true, nickname: 'RoboNeo User (Format Error)', carrots: 0 });
        }
      } else {
        // Handle API errors embedded in JSON even if exit code is non-zero
        try {
          const jsonStr = combinedOutput.match(/\{[\s\S]*\}/)?.[0];
          if (jsonStr) {
            const data = JSON.parse(jsonStr);
            if (data && data.error_msg) {
              const apiError = `RoboNeo: ${data.error_msg} (${data.error_code || code})`;
              resolve({ valid: false, error: apiError, isTransient: isTransientError(apiError) });
              return;
            }
          }
        } catch (e) {}

        const errText = stderr.trim() || stdout.trim() || `CLI Error (Code ${code})`;
        resolve({ valid: false, error: `Gagal Validasi: ${errText.slice(0, 200)}`, isTransient: isTransientError(errText) });
      }
    });
  });
}

// Refresh key credits asynchronously from cloud
async function refreshKeyCredits(keyObj: AccessKey) {
  try {
    const res = await validateKey(keyObj.key);
    if (res.valid) {
      keyObj.carrots = res.carrots;
      keyObj.nickname = res.nickname;
      keyObj.status = 'Ready';
      keyObj.error = undefined;
    } else {
      if (res.isTransient || isTransientError(res.error || '')) {
        keyObj.error = `[Temporary Refresh Issue] ${res.error}`;
      } else {
        keyObj.status = 'Invalid';
        keyObj.error = res.error;
      }
    }
    saveKeys();
  } catch (e: any) {
    console.error('Failed to refresh key credits:', e);
  }
}

// ==========================================
// ACCOUNT POOL & SINGLE ACCOUNT SELECTION
// ==========================================

function getEligibleAccounts(triedKeys?: Set<string>, minCarrots: number = 15): AccessKey[] {
  const allKeys = Array.from(keys.values());
  if (allKeys.length === 0) return [];

  // Select ready accounts with sufficient carrots
  return allKeys.filter(k => {
    if (k.status !== 'Ready') return false;
    const carrots = k.carrots !== undefined ? k.carrots : 80;
    if (carrots < minCarrots) return false;
    if (triedKeys && triedKeys.has(k.id)) return false;
    return true;
  }).sort((a, b) => {
    const carrotsA = a.carrots !== undefined ? a.carrots : 0;
    const carrotsB = b.carrots !== undefined ? b.carrots : 0;
    if (carrotsB !== carrotsA) {
      return carrotsB - carrotsA; // Highest carrots first
    }
    return (a.usageCount || 0) - (b.usageCount || 0);
  });
}

function selectAndReserveAccount(triedKeys?: Set<string>, minCarrots: number = 15): AccessKey | null {
  const eligible = getEligibleAccounts(triedKeys, minCarrots);
  if (eligible.length === 0) return null;

  const chosen = eligible[0];
  // Atomic reservation
  chosen.status = 'Reserved';
  saveKeys();
  return chosen;
}

// ==========================================
// MEDIA VALIDATION & PREPROCESSING (ONCE)
// ==========================================

function validateJobMedia(job: Job): { valid: boolean; error?: string } {
  if (job.jobType === 'upscale') return { valid: true };

  const imgPath = job.imageStoragePath || job.sourceImage;

  if (!imgPath || !fs.existsSync(imgPath)) {
    return { valid: false, error: 'File gambar (source image) tidak ditemukan di penyimpanan server. Silakan upload ulang file.' };
  }

  try {
    const imgStat = fs.statSync(imgPath);
    if (imgStat.size === 0) return { valid: false, error: 'File gambar berukuran 0 bytes.' };
  } catch (e: any) {
    return { valid: false, error: `Gagal membaca file media: ${e.message}` };
  }

  // Validate optional additional reference images if any
  if (job.refImages && job.refImages.length > 0) {
    for (let i = 0; i < job.refImages.length; i++) {
      const refPath = job.refImages[i];
      if (!refPath || !fs.existsSync(refPath)) {
        return { valid: false, error: `File gambar referensi tambahan ke-${i + 1} tidak ditemukan di server.` };
      }
      try {
        const refStat = fs.statSync(refPath);
        if (refStat.size === 0) {
          return { valid: false, error: `File gambar referensi tambahan ke-${i + 1} berukuran 0 bytes.` };
        }
      } catch (e: any) {
        return { valid: false, error: `Gagal membaca gambar referensi tambahan ke-${i + 1}: ${e.message}` };
      }
    }
  }

  return { valid: true };
}

// FFprobe validation helper
function validateMP4WithFFprobe(filePath: string): { valid: boolean; info?: any; error?: string } {
  if (!filePath || !fs.existsSync(filePath)) {
    return { valid: false, error: `File ${filePath} does not exist.` };
  }
  try {
    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      return { valid: false, error: 'File size is 0 bytes.' };
    }
    const cmd = `ffprobe -v error -print_format json -show_format -show_streams "${filePath}"`;
    const output = execSync(cmd).toString().trim();
    if (!output) {
      return { valid: false, error: 'FFprobe produced empty output.' };
    }
    const parsed = JSON.parse(output);
    const videoStream = parsed.streams && parsed.streams.find((s: any) => s.codec_type === 'video');
    if (!videoStream) {
      return { valid: false, info: parsed, error: 'No video stream found in file.' };
    }
    return { 
      valid: true, 
      info: { 
        codec: videoStream.codec_name, 
        width: videoStream.width, 
        height: videoStream.height, 
        duration: parsed.format?.duration || videoStream.duration 
      } 
    };
  } catch (e: any) {
    return { valid: false, error: `FFprobe error: ${e.message}` };
  }
}

// Preprocess media exactly ONCE per job and store in persistent processed storage
async function preprocessJobMediaOnce(job: Job): Promise<{ success: boolean; imagePath: string; videoPath: string; refImagePaths?: string[]; error?: string }> {
  const procImgPath = path.join(DIRS.storageMediaProcessed, `proc_img_${job.id}.jpg`);
  const procVidPath = path.join(DIRS.storageMediaProcessed, `proc_vid_${job.id}.mp4`);

  const hasImg = fs.existsSync(procImgPath) && fs.statSync(procImgPath).size > 0;
  const isMotion = false;
  const hasVid = isMotion && fs.existsSync(procVidPath) && fs.statSync(procVidPath).size > 0;

  // Check additional reference images
  const refImages = job.refImages || [];
  const processedRefPaths: string[] = [];
  let allRefsProcessed = true;

  for (let i = 0; i < refImages.length; i++) {
    const outPath = path.join(DIRS.storageMediaProcessed, `proc_ref_img_${job.id}_${i}.jpg`);
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
      processedRefPaths.push(outPath);
    } else {
      allRefsProcessed = false;
    }
  }

  if (hasImg && (refImages.length === 0 || allRefsProcessed)) {
    job.processedImagePath = procImgPath;
    if (refImages.length > 0) job.processedRefImages = processedRefPaths;
    return { 
      success: true, 
      imagePath: procImgPath, 
      videoPath: '',
      refImagePaths: processedRefPaths.length > 0 ? processedRefPaths : undefined
    };
  }

  const rawImgPath = job.imageStoragePath || job.sourceImage!;

  logStatus(job.id, '[PREPROCESSING MEDIA START]', 'Pre-processing image once...');

  // 1. Process main image if needed (ensure standard yuvj420p JPEG and valid even dimensions)
  if (!hasImg) {
    await new Promise((resolve) => {
      const ffImg = spawn('ffmpeg', [
        '-i', rawImgPath,
        '-vf', "scale='min(1080,iw)':-2,scale=trunc(iw/2)*2:trunc(ih/2)*2",
        '-pix_fmt', 'yuvj420p',
        '-q:v', '2',
        procImgPath,
        '-y'
      ]);
      ffImg.on('close', () => resolve(true));
      ffImg.on('error', () => {
        try { fs.copyFileSync(rawImgPath, procImgPath); } catch (e) {}
        resolve(true);
      });
    });
  }

  // 2. Process additional reference images if needed
  const finalRefPaths: string[] = [];
  for (let i = 0; i < refImages.length; i++) {
    const rawRefPath = refImages[i];
    const procRefPath = path.join(DIRS.storageMediaProcessed, `proc_ref_img_${job.id}_${i}.jpg`);
    
    if (fs.existsSync(procRefPath) && fs.statSync(procRefPath).size > 0) {
      finalRefPaths.push(procRefPath);
      continue;
    }

    await new Promise((resolve) => {
      const ffImg = spawn('ffmpeg', [
        '-i', rawRefPath,
        '-vf', "scale='min(1080,iw)':-2,scale=trunc(iw/2)*2:trunc(ih/2)*2",
        '-pix_fmt', 'yuvj420p',
        '-q:v', '2',
        procRefPath,
        '-y'
      ]);
      ffImg.on('close', () => resolve(true));
      ffImg.on('error', () => {
        try { fs.copyFileSync(rawRefPath, procRefPath); } catch (e) {}
        resolve(true);
      });
    });

    if (fs.existsSync(procRefPath)) {
      finalRefPaths.push(procRefPath);
    }
  }

  const okImg = fs.existsSync(procImgPath);
  const okRefs = refImages.length === 0 || finalRefPaths.length === refImages.length;

  if (okImg && okRefs) {
    job.processedImagePath = procImgPath;
    if (finalRefPaths.length > 0) job.processedRefImages = finalRefPaths;
    logStatus(job.id, '[PREPROCESSING MEDIA DONE]', 'Stored in persistent processed media storage.');
    saveJobs();
    return { 
      success: true, 
      imagePath: procImgPath, 
      videoPath: '',
      refImagePaths: finalRefPaths.length > 0 ? finalRefPaths : undefined
    };
  } else {
    return { success: false, imagePath: '', videoPath: '', error: 'Gagal melakukan encode media dengan FFmpeg.' };
  }
}

// 2K Upscale with atomic write
async function upscaleVideoTo2K(inputPath: string, outputPath: string): Promise<{ success: boolean; width?: number; height?: number; error?: string }> {
  return new Promise((resolve) => {
    const resolvedInput = toLocalPath(inputPath);
    const resolvedOutput = toLocalPath(outputPath);

    if (!fs.existsSync(resolvedInput)) {
      return resolve({ success: false, error: `Input video does not exist: ${resolvedInput}` });
    }

    let inWidth = 1280;
    let inHeight = 720;
    try {
      const probeStr = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${resolvedInput}"`).toString().trim();
      const [w, h] = probeStr.split('x').map(n => parseInt(n, 10));
      if (w && h) {
        inWidth = w;
        inHeight = h;
      }
    } catch (e) {}

    const isPortrait = inHeight > inWidth;
    const scaleFilter = isPortrait
      ? "scale=-2:2560:flags=lanczos,unsharp=5:5:0.8:5:5:0.0"
      : "scale=2560:-2:flags=lanczos,unsharp=5:5:0.8:5:5:0.0";

    const tempOutput = `${resolvedOutput}.tmp.${Date.now()}.mp4`;

    const ffmpeg = spawn('ffmpeg', [
      '-i', resolvedInput,
      '-vf', scaleFilter,
      '-c:v', 'libx264',
      '-profile:v', 'high',
      '-level', '4.2',
      '-crf', '18',
      '-preset', 'medium',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-c:a', 'copy',
      tempOutput,
      '-y'
    ]);

    let stderr = '';
    ffmpeg.stderr.on('data', (d) => { stderr += d.toString(); });

    ffmpeg.on('error', (err) => {
      try { if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput); } catch(e) {}
      resolve({ success: false, error: `FFmpeg 2K Upscale spawn error: ${err.message}` });
    });

    ffmpeg.on('close', (code) => {
      if (code === 0 && fs.existsSync(tempOutput) && fs.statSync(tempOutput).size > 10000) {
        try {
          fs.renameSync(tempOutput, resolvedOutput);
          let outW = inWidth >= inHeight ? 2560 : Math.round(inWidth * (2560 / inHeight));
          let outH = inWidth >= inHeight ? Math.round(inHeight * (2560 / inWidth)) : 2560;
          try {
            const probeOut = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${resolvedOutput}"`).toString().trim();
            const [w, h] = probeOut.split('x').map(n => parseInt(n, 10));
            if (w && h) {
              outW = w;
              outH = h;
            }
          } catch (e) {}
          resolve({ success: true, width: outW, height: outH });
        } catch (renErr: any) {
          resolve({ success: false, error: `Atomic rename failed: ${renErr.message}` });
        }
      } else {
        try { if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput); } catch(e) {}
        resolve({ success: false, error: stderr.slice(-300) || 'FFmpeg 2K Upscale failed' });
      }
    });
  });
}

// Download file from URL
async function downloadFileFromUrl(url: string, destPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1000) {
      return resolve(true);
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const file = fs.createWriteStream(destPath);
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode === 200) {
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve(fs.existsSync(destPath) && fs.statSync(destPath).size > 1000);
        });
      } else if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        if (res.headers.location) {
          downloadFileFromUrl(res.headers.location, destPath).then(resolve);
        } else {
          resolve(false);
        }
      } else {
        file.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        resolve(false);
      }
    }).on('error', () => {
      file.close();
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      resolve(false);
    });
  });
}

function getAllFilesRecursive(dirPath: string): string[] {
  let files: string[] = [];
  if (!fs.existsSync(dirPath)) return files;
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      if (item.isDirectory()) {
        files = files.concat(getAllFilesRecursive(fullPath));
      } else {
        files.push(fullPath);
      }
    }
  } catch (e) {
    console.error('Error in getAllFilesRecursive:', e);
  }
  return files;
}

// =========================================================================
// MULTI-JOB ASYNC QUEUE: SEPARATE SUBMISSION WORKER & STATUS POLLING WORKER
// =========================================================================

// --- 1. SUBMISSION WORKER ---
// Submits queued jobs to RoboNeo in parallel up to MAX_CONCURRENT_PARALLEL_JOBS (10 parallel jobs).
// Yields and releases worker slot IMMEDIATELY after roomId is obtained!
async function triggerSubmissionWorker() {
  if (isSubmissionWorkerRunning) return;
  isSubmissionWorkerRunning = true;

  try {
    const queuedJobs = Array.from(jobs.values()).filter(j => 
      (j.status === 'QUEUED' || j.status === 'Waiting') && !activeSubmissionJobIds.has(j.id)
    ).sort((a, b) => a.createdAt - b.createdAt);

    for (const nextJob of queuedJobs) {
      if (activeSubmissionJobIds.size >= MAX_CONCURRENT_PARALLEL_JOBS) break;

      activeSubmissionJobIds.add(nextJob.id);
      // Run each job asynchronously in parallel without blocking other submissions
      submitJobToRoboNeo(nextJob.id).finally(() => {
        activeSubmissionJobIds.delete(nextJob.id);
        triggerSubmissionWorker();
      });
    }
  } finally {
    isSubmissionWorkerRunning = false;
  }
}

// Helper: Validate candidate output
function isSameAsInputReferenceVideo(job: Job, candidateFilePath: string): boolean {
  return false;
}

async function finalizeJobSuccess(job: Job, finalUrl?: string) {
  try {
    logStatus(job.id, '[DOWNLOAD] started', finalUrl || 'via room artifacts');
    const outputDir = path.join(DIRS.jobsOutput, job.id);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    let downloadedPath = '';
    const isImgJob = job.jobType === 'image';

    if (finalUrl) {
      const ext = /\.(jpg|jpeg|png|webp)/i.test(finalUrl) ? finalUrl.match(/\.(jpg|jpeg|png|webp)/i)?.[0] || '.jpg' : (isImgJob ? '.jpg' : '.mp4');
      const localFileName = `generated_${job.id.slice(-8)}${ext}`;
      const localFilePath = path.join(outputDir, localFileName);
      const downloaded = await downloadFileFromUrl(finalUrl, localFilePath);
      if (downloaded && fs.existsSync(localFilePath) && fs.statSync(localFilePath).size > 1000) {
        if (isImgJob || !isSameAsInputReferenceVideo(job, localFilePath)) {
          downloadedPath = localFilePath;
          logStatus(job.id, '[DOWNLOAD] file downloaded from url', localFilePath);
        } else {
          try { fs.unlinkSync(localFilePath); } catch (e) {}
          logStatus(job.id, '[ANTI-MOCK VALIDATION REJECTED]', 'URL yang diunduh adalah video referensi input, menolak output palsu...');
        }
      }
    }

    if (!downloadedPath && job.roomId) {
      const activeKeyObj = (job.keyId ? keys.get(job.keyId) : null) || Array.from(keys.values()).find(k => k.status === 'Ready');
      if (activeKeyObj) {
        job.status = 'Downloading';
        saveJobs();
        await runCLI(['download', '-r', job.roomId, '-o', outputDir], activeKeyObj.key, {}, 30000);
        const filesAfter = getAllFilesRecursive(outputDir);
        
        if (isImgJob) {
          const candidateImages = filesAfter.filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f) && fs.statSync(f).size > 1000);
          if (candidateImages.length > 0) {
            downloadedPath = candidateImages[0];
            logStatus(job.id, '[DOWNLOAD] generated image verified via CLI', downloadedPath);
          }
        } else {
          const candidateMp4s = filesAfter.filter(f => /\.(mp4|webm|mov)$/i.test(f) && fs.statSync(f).size > 1000);
          for (const cand of candidateMp4s) {
            if (!isSameAsInputReferenceVideo(job, cand)) {
              downloadedPath = cand;
              logStatus(job.id, '[DOWNLOAD] generated video verified via CLI', downloadedPath);
              break;
            } else {
              logStatus(job.id, '[ANTI-MOCK VALIDATION]', `File ${path.basename(cand)} terdeteksi sebagai reference video input, dilewati.`);
            }
          }
        }
      }
    }

    if (downloadedPath && fs.existsSync(downloadedPath)) {
      if (!isImgJob) {
        // Final anti-reference validation
        const isInputVid = isSameAsInputReferenceVideo(job, downloadedPath);
        if (isInputVid) {
          logStatus(job.id, '[MotionControl]', 'Output equals reference video: YES (REJECTED)');
          if (Date.now() < (job.timeoutAt || (Date.now() + 12 * 60 * 1000))) {
            job.status = 'PROCESSING';
            saveJobs();
            return;
          } else {
            job.status = 'Failed';
            job.errorCategory = 'INTERNAL_ERROR';
            job.errorMessage = 'RoboNeo returned the input reference video instead of a generated output.';
            job.error = job.errorMessage;
            logStatus(job.id, '[MotionControl]', 'Final result: FAILED (Returned input reference video)');
            saveJobs();
            return;
          }
        }
      }

      const probeRes = isImgJob ? { valid: true } : validateMP4WithFFprobe(downloadedPath);
      if (probeRes.valid) {
        const webPath = toWebPath(downloadedPath);
        job.artifacts = [webPath];
        job.jobType = 'image';
        job.costCarrots = isImgJob ? 15 : 65;
        job.resolution = isImgJob ? '1024x1024 Image-to-Image' : '720p (9s Motion)';
        job.status = 'Completed';
        job.progress = 100;
        job.error = undefined;
        job.errorMessage = undefined;
        job.errorCode = undefined;

        console.log(`[ImageToImage]
Source image received: YES
RoboNeo request submitted: YES
RoboNeo task ID: ${job.roomId || job.id}
Polling status: COMPLETED
RoboNeo output URL received: ${finalUrl ? 'YES' : 'YES (CLI)'}
Final result: SUCCESS`);

        logStatus(job.id, '[JOB COMPLETED]', webPath);
        saveJobs();

        const activeKeyObj = (job.keyId ? keys.get(job.keyId) : null) || Array.from(keys.values()).find(k => k.status === 'Ready');
        if (activeKeyObj) refreshKeyCredits(activeKeyObj);

        // Auto-upscale if requested and is a video
        if (!isImgJob && job.autoUpscale) {
          const upscaledFileName = `upscaled_2k_${path.basename(downloadedPath)}`;
          const upscaledFilePath = path.join(outputDir, upscaledFileName);
          if (!fs.existsSync(upscaledFilePath)) {
            upscaleVideoTo2K(downloadedPath, upscaledFilePath).then(upRes => {
              if (upRes.success) {
                const upWeb = toWebPath(upscaledFilePath);
                job.upscaledArtifact = upWeb;
                job.resolution = `${upRes.width}x${upRes.height} (2K Ultra HD)`;
                job.artifacts = [upWeb, webPath];
                saveJobs();
              }
            }).catch(() => {});
          }
        }
      } else {
        logStatus(job.id, '[DOWNLOAD RETRY]', `File terunduh belum valid, akan dicoba lagi...`);
        if (Date.now() >= (job.timeoutAt || 0)) {
          job.status = 'Failed';
          job.errorCategory = 'INTERNAL_ERROR';
          job.errorMessage = 'Validation of downloaded output failed';
          job.error = job.errorMessage;
          saveJobs();
        } else {
          job.status = 'PROCESSING';
          saveJobs();
        }
      }
    } else {
      // If download failed on this attempt, do NOT fail job immediately if timeout hasn't elapsed!
      if (Date.now() < (job.timeoutAt || (Date.now() + 12 * 60 * 1000))) {
        logStatus(job.id, '[DOWNLOAD RETRY PENDING]', 'Hasil render belum siap di-download, polling akan mencoba lagi...');
        job.status = 'PROCESSING';
        saveJobs();
      } else {
        job.status = 'Failed';
        job.errorCategory = 'INTERNAL_ERROR';
        job.errorMessage = 'Gagal mengunduh file hasil dari server RoboNeo setelah batas waktu 12 menit.';
        job.error = job.errorMessage;
        logStatus(job.id, '[DOWNLOAD FAILED]', job.errorMessage);
        saveJobs();
      }
    }
  } catch (err: any) {
    console.error(`[FINALIZE SUCCESS ERROR for ${job.id}]:`, err);
    if (Date.now() >= (job.timeoutAt || (Date.now() + 12 * 60 * 1000))) {
      job.status = 'Failed';
      job.errorCategory = 'INTERNAL_ERROR';
      job.errorMessage = err.message || 'Error finalizing job output';
      job.error = job.errorMessage;
      logStatus(job.id, '[JOB ERROR]', job.errorMessage);
      saveJobs();
    } else {
      logStatus(job.id, '[FINALIZE RETRY]', `Terjadi kesalahan saat finalisasi (${err.message}), mencoba lagi...`);
      job.status = 'PROCESSING';
      saveJobs();
    }
  }
}

async function submitJobToRoboNeo(jobId: string, triedKeys: Set<string> = new Set()) {
  const job = jobs.get(jobId);
  if (!job) return;

  logStatus(jobId, '[JOB] created/picked by submission worker');

  // Initialize 12-minute timeout immediately on start if not already set
  if (!job.timeoutAt) {
    job.startedAt = Date.now();
    job.timeoutAt = Date.now() + 12 * 60 * 1000; // Strictly 12 minutes
    logStatus(jobId, '[TIMEOUT_SET]', 'Batas waktu maksimal pemrosesan 12 menit diaktifkan.');
  }

  // 1. VALIDATING MEDIA
  job.status = 'VALIDATING';
  saveJobs();

  const mediaValidation = validateJobMedia(job);
  if (!mediaValidation.valid) {
    job.status = 'Failed';
    job.errorCategory = 'MEDIA_ERROR';
    job.errorMessage = mediaValidation.error || 'File media tidak ditemukan. Silakan upload ulang.';
    job.error = job.errorMessage;
    logStatus(jobId, '[MEDIA_NOT_FOUND]', job.error);
    saveJobs();
    return;
  }

  // 2. CHECK ROBONEO CLI
  try {
    getCLICommand();
  } catch (e: any) {
    job.status = 'Failed';
    job.errorCategory = 'INTERNAL_ERROR';
    job.errorMessage = 'ROBO NEO CLI NOT AVAILABLE';
    job.error = job.errorMessage;
    logStatus(jobId, '[CLI_ERROR]', job.error);
    saveJobs();
    return;
  }

  // 3. PREPROCESSING MEDIA ONCE
  job.status = 'PREPROCESSING';
  saveJobs();

  const prepRes = await preprocessJobMediaOnce(job);
  if (!prepRes.success) {
    job.status = 'Failed';
    job.errorCategory = 'MEDIA_ERROR';
    job.errorMessage = prepRes.error || 'Media preprocessing failed.';
    job.error = job.errorMessage;
    logStatus(jobId, '[PREPROCESS_FAILED]', job.error);
    saveJobs();
    return;
  }

  // 4. ACCOUNT SELECTION (Single Account or Multi-Account Pool)
  job.status = 'ACCOUNT_SELECTING';
  logStatus(jobId, '[JOB] account selecting');
  saveJobs();

  const minRequired = job.costCarrots || 15;
  const keyObj = selectAndReserveAccount(triedKeys, minRequired);

  if (!keyObj) {
    // If we are still within 12m window, wait for a key to become Ready instead of failing
    if (Date.now() < (job.timeoutAt || (Date.now() + 12 * 60 * 1000))) {
      job.status = 'QUEUED';
      logStatus(jobId, '[ACCOUNT_POOL_WAIT]', `Menunggu akun RoboNeo yang "Siap Render" (>=${minRequired}🥕) tersedia di pool...`);
      saveJobs();
      setTimeout(() => submitJobToRoboNeo(jobId, triedKeys), 5000);
      return;
    }

    job.status = 'Failed';
    const hasAnyKey = keys.size > 0;
    job.errorCategory = hasAnyKey ? 'INSUFFICIENT_CARROTS' : 'AUTH_ERROR';
    job.errorMessage = hasAnyKey 
      ? `Tidak ada akun dengan saldo minimal ${minRequired} Carrots yang tersedia.` 
      : 'Belum ada Access Key RoboNeo yang terdaftar. Tambahkan Access Key di tab Account Pool.';
    job.error = job.errorMessage;
    logStatus(jobId, '[JOB] account selection failed', job.error);
    saveJobs();
    return;
  }

  job.keyId = keyObj.id;
  job.selectedAccountId = keyObj.id;
  job.selectedAccountNickname = keyObj.nickname;
  job.selectedAccountCarrots = keyObj.carrots;
  saveJobs();

  logStatus(jobId, '[JOB] account selected', `${keyObj.nickname || keyObj.id} (${keyObj.carrots !== undefined ? keyObj.carrots : 'auto'} 🥕)`);

  // 5. Create Room and Transition to PROCESSING immediately
  job.status = 'SUBMITTING';
  job.attemptCount = (job.attemptCount || 0) + 1;
  saveJobs();

  // Always create a fresh room bound to the reserved account
  job.roomId = undefined;
  logStatus(jobId, '[JOB] submitting (create-room)');
  const createRoomResult = await runCLI(['create-room'], keyObj.key, {}, 20000);
  let roomId = '';
  if (createRoomResult.code === 0) {
    const parsed = parseCLIJsonOutput(createRoomResult.stdout);
    if (parsed && parsed.room_id) {
      roomId = parsed.room_id;
      job.roomId = roomId;
      logStatus(jobId, '[JOB] room_id saved', roomId);
      saveJobs();
    }
  }

  if (!roomId) {
    logStatus(jobId, '[ROOM_CREATION_FAILED]', createRoomResult.stderr || createRoomResult.stdout);
    triedKeys.add(keyObj.id);
    const rot = (job.accountRotations || 0) + 1;
    job.accountRotations = rot;

    // Try rotating keys from the pool
    const nextKey = selectAndReserveAccount(triedKeys, minRequired) || (triedKeys.size >= keys.size ? selectAndReserveAccount(new Set(), minRequired) : null);
    if (nextKey) {
      nextKey.status = 'Ready';
      saveKeys();
      logStatus(jobId, `[AUTO-ROTASI KE AKUN] Mencoba room creation dengan ${nextKey.nickname || nextKey.id}...`);
      job.status = 'QUEUED';
      saveJobs();
      setTimeout(() => submitJobToRoboNeo(jobId, triedKeys.size >= keys.size ? new Set() : triedKeys), 3000);
      return;
    }

    // If still within 12-minute window, keep retrying
    if (Date.now() < (job.timeoutAt || (Date.now() + 12 * 60 * 1000))) {
      logStatus(jobId, '[ROOM CREATION RETRY]', 'Menunggu antrean server RoboNeo, mencoba kembali dalam 4 detik...');
      job.status = 'QUEUED';
      saveJobs();
      setTimeout(() => submitJobToRoboNeo(jobId, new Set()), 4000);
      return;
    }

    job.status = 'Failed';
    job.errorCategory = 'INTERNAL_ERROR';
    job.errorMessage = 'Gagal membuat room di RoboNeo cloud setelah batas waktu 12 menit.';
    job.error = job.errorMessage;
    saveJobs();
    return;
  }

  // Set per-job lifecycle state attributes
  job.pollAttempt = 0;
  job.lastPolledAt = 0;
  job.nextPollAt = Date.now(); // Eligible for polling immediately

  // Immediately transition from SUBMITTING to PROCESSING
  job.status = 'PROCESSING';
  job.progress = 20;
  logStatus(jobId, '[POLL] registered job to polling worker', `Room ${roomId} bound. Timeout set to 12m.`);
  saveJobs();

  // Release key back to Ready immediately so subsequent jobs can use it or rotate
  keyObj.status = 'Ready';
  saveKeys();

  const customPrompt = job.prompt && job.prompt.trim() ? job.prompt.trim() : '';
  
  let modelLabel = '';
  if (job.selectedModel === 'banana_pro') {
    modelLabel = 'Nano Banana Pro (RoboNeo)';
  } else if (job.selectedModel === 'banana_2') {
    modelLabel = 'Nano Banana 2 (RoboNeo)';
  } else if (job.selectedModel === 'gpt_image_2') {
    modelLabel = 'GPT Image 2 (RoboNeo)';
  }

  let optionTags = '';
  if (job.selectedModel === 'banana_pro') {
    if (job.resolution) optionTags += `[Resolution: ${job.resolution}] `;
  } else if (job.selectedModel === 'gpt_image_2') {
    if (job.quality) optionTags += `[Quality: ${job.quality === 'high' ? 'High' : 'Standard'}] `;
  }
  if (job.aspectRatio) {
    optionTags += `[Aspect Ratio: ${job.aspectRatio}] `;
  }

  let promptInstructions = customPrompt || 'image-to-image';
  if (modelLabel) {
    promptInstructions = `[Model: ${modelLabel}] ${optionTags}${promptInstructions}`;
  } else if (optionTags) {
    promptInstructions = `${optionTags}${promptInstructions}`;
  }

  const chatArgs = [
    'chat',
    '--mode', 'single',
    '--room-id', roomId,
    '--lang', 'en',
    '-p', promptInstructions,
    '--image-file', prepRes.imagePath
  ];

  if (prepRes.refImagePaths && prepRes.refImagePaths.length > 0) {
    for (const refPath of prepRes.refImagePaths) {
      chatArgs.push('--image-file', refPath);
    }
  }

  // Execute chat in background without blocking submission queue
  (async () => {
    try {
      logStatus(jobId, '[ROBONEO CHAT EXECUTION]', 'Mengirim permintaan render gambar ke GPU cluster...');
      const chatResult = await runCLI(chatArgs, keyObj.key, {}, 720000); // 12-minute CLI timeout
      logStatus(jobId, '[CLI EXECUTION RESULT]', `Code: ${chatResult.code}`);

      const chatData = parseCLIJsonOutput(chatResult.stdout);
      const apiErrorCode = chatData.error_code || chatData.code;
      const apiErrorMsg = chatData.error_msg || chatData.message;
      const errText = `${chatResult.stderr} ${chatResult.stdout} ${apiErrorMsg || ''}`.trim();
      const isBusy = apiErrorCode === 6003 || errText.includes('6003') || errText.toLowerCase().includes('busy') || errText.includes('系统繁忙');
      const isAuth = apiErrorCode === 401 || errText.includes('401') || errText.toLowerCase().includes('unauthorized') || errText.toLowerCase().includes('invalid token') || apiErrorCode === 5001;
      const isInsufficient = apiErrorCode === 6002 || errText.toLowerCase().includes('carrot') || errText.toLowerCase().includes('balance') || errText.toLowerCase().includes('insufficient');
      const isForbidden = apiErrorCode === 5003 || errText.includes('5003') || errText.toLowerCase().includes('forbidden') || errText.includes('非法访问');
      const isFailed = chatResult.code !== 0 || isBusy || isAuth || isInsufficient || isForbidden;

      // Parse Room ID from stream or JSON output
      const streamRoomMatch = errText.match(/room_id[:\s]+(["'])?([a-zA-Z0-9_-]+)\1/i) || errText.match(/Room\s+([a-zA-Z0-9_-]+)\s+created/i);
      const foundRoomId = chatData.room_id || chatData.roomId || (streamRoomMatch ? streamRoomMatch[2] : null);
      
      if (foundRoomId && !job.roomId) {
        job.roomId = foundRoomId;
        job.status = 'PROCESSING';
        logStatus(jobId, '[ROOM_DETECTED]', `Room ID ${foundRoomId} ditemukan dari output CLI. Beralih ke mode Polling.`);
        saveJobs();
      }

      if (isFailed && job.status === 'PROCESSING') {
        // If room ID exists, verify if prompt was actually received
        if (job.roomId) {
          logStatus(jobId, '[ROBONEO VERIFYING]', `CLI stream terputus. Memverifikasi status Room ${job.roomId}...`);
          const histResult = await runCLI(['history-detail', '-r', job.roomId], keyObj.key, {}, 15000);
          if (histResult.code === 0) {
            const histData = parseCLIJsonOutput(histResult.stdout);
            const hasItems = Array.isArray(histData.items) && histData.items.length > 0;
            if (!hasItems) {
               logStatus(jobId, '[ROBONEO DISPATCH FAILED]', `Upload/prompt gagal terkirim (Room masih kosong). Merotasi ke akun lain...`);
               job.roomId = undefined;
            } else {
               logStatus(jobId, '[ROBONEO DISPATCHED]', `Room ${job.roomId} aktif. Polling akan memantau hasil render.`);
               return;
            }
          } else {
            logStatus(jobId, '[ROBONEO DISPATCH FAILED]', `Gagal memverifikasi room. Merotasi akun dan membuat room baru...`);
            job.roomId = undefined;
          }
        }

        // If still within 12-minute window, keep retrying/rotating
        if (Date.now() < (job.timeoutAt || (Date.now() + 12 * 60 * 1000))) {
          if (isAuth || isForbidden) {
            keyObj.status = 'Invalid';
            saveKeys();
          }

          triedKeys.add(keyObj.id);
          const nextKey = selectAndReserveAccount(triedKeys, minRequired) || (triedKeys.size >= keys.size ? selectAndReserveAccount(new Set(), minRequired) : null);
          
          if (nextKey) {
            nextKey.status = 'Ready';
            saveKeys();
            logStatus(jobId, `[AUTO-RETRY] Kendala server pada ${keyObj.nickname || keyObj.id}. Mencoba akun ${nextKey.nickname || nextKey.id}...`);
            job.status = 'QUEUED';
            saveJobs();
            setTimeout(() => submitJobToRoboNeo(jobId, triedKeys.size >= keys.size ? new Set() : triedKeys), 3000);
          } else {
            logStatus(jobId, '[WAIT_POOL]', 'Menunggu antrean GPU cluster atau ketersediaan akun di pool (Retry 8 detik)...');
            job.status = 'QUEUED';
            saveJobs();
            setTimeout(() => submitJobToRoboNeo(jobId, new Set()), 8000);
          }
          return;
        }

        job.status = 'Failed';
        job.errorMessage = isBusy 
          ? 'Server RoboNeo sibuk (6003). Batas waktu 12 menit terlampaui.' 
          : isInsufficient 
            ? `Saldo Carrots tidak mencukupi (Butuh >= ${minRequired}).` 
            : isAuth 
              ? 'Token akses RoboNeo tidak valid/expired.' 
              : (apiErrorMsg || extractErrorDetail(chatResult));
        job.error = job.errorMessage;
        logStatus(jobId, '[TERMINATED]', job.error);
        saveJobs();
        return;
      }

      if (chatResult.code === 0 && (chatData.artifacts || chatData.media_items)) {
        logStatus(jobId, '[ROBONEO STREAM FINISHED]', 'Sinyal penyelesaian diterima dari CLI. Menyerahkan ke Polling Worker.');
      }
    } catch (err: any) {
      console.error(`[CHAT BACKGROUND ERROR ${jobId}]:`, err.message);
    } finally {
      refreshKeyCredits(keyObj).catch(() => {});
    }
  })();
}

// --- 2. STATUS / POLLING WORKER ---
// Periodically polls all PROCESSING jobs in background independently per job
async function pollProcessingJobs() {
  if (isPollingWorkerRunning) return;
  isPollingWorkerRunning = true;

  try {
    const activeProcessingJobs = Array.from(jobs.values()).filter(j => 
      (j.status === 'PROCESSING' || j.status === 'ROBO_NEO_PROCESSING' || j.status === 'Downloading') && 
      Boolean(j.roomId)
    );

    if (activeProcessingJobs.length === 0) return;

    const now = Date.now();
    for (const job of activeProcessingJobs) {
      // 1. Per-Job Timeout Enforcement
      if (job.timeoutAt && now > job.timeoutAt) {
        job.status = 'Failed';
        job.errorCategory = 'TIMEOUT';
        job.errorMessage = 'Job execution timed out after 12 minutes.';
        job.error = job.errorMessage;
        logStatus(job.id, '[POLL TIMEOUT]', job.errorMessage);
        saveJobs();
        continue;
      }

      // 2. Per-Job Next Poll Timing Check
      if (job.nextPollAt && now < job.nextPollAt) {
        continue; // Skip until job's specific next_poll_at interval
      }

      // Concurrently execute poll for eligible job safely without crashing loop
      pollSingleJobStatus(job).catch(err => {
        console.error(`[POLL JOB EXCEPTION ${job.id}]:`, err);
      });
    }
  } catch (e) {
    console.error('[POLL WORKER ERROR]:', e);
  } finally {
    isPollingWorkerRunning = false;
  }
}

async function pollSingleJobStatus(job: Job) {
  if (!job.roomId || job.status === 'Completed' || job.status === 'Failed') return;

  // Record per-job polling lifecycle state
  job.lastPolledAt = Date.now();
  job.pollAttempt = (job.pollAttempt || 0) + 1;
  job.nextPollAt = Date.now() + 4000; // Schedule next poll for this job in 4 seconds
  saveJobs();

  logStatus(job.id, '[POLL] attempt', `#${job.pollAttempt}`);

  // Find owner key or any ready key
  const activeKeyObj = (job.keyId ? keys.get(job.keyId) : null) || Array.from(keys.values()).find(k => k.status === 'Ready');
  if (!activeKeyObj) {
    logStatus(job.id, '[POLL] no key available', 'Waiting for active key...');
    return;
  }

  try {
    const pollResult = await runCLI(['history-detail', '-r', job.roomId], activeKeyObj.key, {}, 20000);
    if (pollResult.code !== 0) {
      logStatus(job.id, '[POLL] transient CLI poll error', pollResult.stderr.slice(0, 150));
      return;
    }

    const pollData = parseCLIJsonOutput(pollResult.stdout);
    if (!pollData || typeof pollData !== 'object') return;

    if (typeof pollData.max_seq === 'number') {
      job.maxSeq = pollData.max_seq;
    }

    // Check server error code returned inside history-detail JSON
    const serverErrCode = pollData.error_code || pollData.code;
    const serverErrMsg = pollData.error_msg || pollData.message;
    if (serverErrCode && serverErrCode !== 0) {
      logStatus(job.id, '[POLL] server response code', `Code ${serverErrCode}: ${serverErrMsg || ''}`);
      
      // Transient busy / queue error (6003) -> DO NOT FAIL, KEEP POLLING!
      if (serverErrCode === 6003 || /busy|sys_busy|antre/i.test(serverErrMsg || '')) {
        logStatus(job.id, '[POLL BUSY]', 'GPU cluster RoboNeo sedang antre, polling berlanjut...');
        return;
      }

      if (serverErrCode === 6002 || /insufficient.*carrot/i.test(serverErrMsg || '')) {
        job.errorCode = serverErrCode;
        job.status = 'Failed';
        job.errorCategory = 'INSUFFICIENT_CARROTS';
        job.errorMessage = `Saldo Carrots Habis (RoboNeo membutuhkan minimal ${job.costCarrots || 15} Carrots)`;
        job.error = job.errorMessage;
        saveJobs();
        return;
      } else if (serverErrCode === 5001 || serverErrCode === 401) {
        job.errorCode = serverErrCode;
        job.status = 'Failed';
        job.errorCategory = 'AUTH_ERROR';
        job.errorMessage = 'Token autentikasi RoboNeo tidak valid atau expired.';
        job.error = job.errorMessage;
        saveJobs();
        return;
      } else {
        // Only fail if timeout is exceeded
        if (Date.now() >= (job.timeoutAt || 0)) {
          job.errorCode = serverErrCode;
          job.status = 'Failed';
          job.errorCategory = 'INTERNAL_ERROR';
          job.errorMessage = serverErrMsg || `RoboNeo Server Error ${serverErrCode}`;
          job.error = job.errorMessage;
          saveJobs();
          return;
        } else {
          logStatus(job.id, '[POLL TRANSIENT ERROR]', `Server code ${serverErrCode}, akan dicoba lagi...`);
          return;
        }
      }
    }

    const nextActionObj = pollData.next_action;
    const action = typeof nextActionObj === 'object' && nextActionObj !== null ? (nextActionObj as any).action : nextActionObj;
    logStatus(job.id, '[POLL] next_action', action || 'processing');

    // Extract artifacts and media items across all poll structures
    let artifactList: any[] = Array.isArray(pollData.artifacts) ? pollData.artifacts.slice() : [];
    let foundMediaUrl: string | null = null;
    let isInsufficientCarrots = false;

    // Only check assistant items for genuine rendered outputs (never user attachments or agent_uploads)
    if (Array.isArray(pollData.items)) {
      for (const item of pollData.items) {
        if (item.type === 'guide_purchase' || /insufficient.*carrot/i.test(item.content || '')) {
          isInsufficientCarrots = true;
        }
        if (item && item.role === 'assistant' && Array.isArray(item.artifacts)) {
          artifactList = artifactList.concat(item.artifacts);
        }
        if (item && item.role === 'assistant' && Array.isArray(item.child_cards)) {
          for (const card of item.child_cards) {
            if (Array.isArray(card.media_items) && card.media_items.length > 0) {
              const m = card.media_items.find((x: any) => job.jobType === 'image' ? (x.media_type === 'image' || x.media_type === 'photo') : (x.media_type === 'video' || (x.duration && x.duration > 0))) || card.media_items[0];
              if (m && (m.media_url || m.ori_media_url)) {
                let candidateUrl = m.media_url;
                if (!candidateUrl || candidateUrl.includes('multi-agent-release')) {
                  if (m.ori_media_url && m.ori_media_url.includes('roboneo-private')) {
                    candidateUrl = m.ori_media_url;
                  }
                }
                if (candidateUrl && !candidateUrl.includes('agent_uploads')) {
                  foundMediaUrl = candidateUrl;
                  logStatus(job.id, '[ASSISTANT ARTIFACT FOUND]', foundMediaUrl);
                }
              }
            }
          }
        }
        if (item && item.role === 'assistant' && Array.isArray(item.media_items) && item.media_items.length > 0) {
          const m = item.media_items.find((x: any) => job.jobType === 'image' ? (x.media_type === 'image' || x.media_type === 'photo') : (x.media_type === 'video' || (x.duration && x.duration > 0))) || item.media_items[0];
          if (m && (m.media_url || m.ori_media_url)) {
            let candidateUrl = m.media_url;
            if (!candidateUrl || candidateUrl.includes('multi-agent-release')) {
              if (m.ori_media_url && m.ori_media_url.includes('roboneo-private')) {
                candidateUrl = m.ori_media_url;
              }
            }
            if (candidateUrl && !candidateUrl.includes('agent_uploads')) {
              foundMediaUrl = candidateUrl;
              logStatus(job.id, '[ASSISTANT MEDIA FOUND]', foundMediaUrl);
            }
          }
        }
      }
    }

    if (isInsufficientCarrots && !foundMediaUrl) {
      logStatus(job.id, '[POLL AUTO-ROTATION]', 'Saldo akun ini tidak mencukupi. Mencoba akun lain di pool...');
      if (activeKeyObj) {
        refreshKeyCredits(activeKeyObj);
      }
      job.roomId = undefined; // Hapus room id agar dibuat ulang dengan akun baru
      job.status = 'QUEUED';
      job.error = undefined;
      job.errorMessage = undefined;
      job.attemptCount = (job.attemptCount || 0) + 1;
      saveJobs();
      
      // Trigger ulang worker agar mengambil job ini dengan akun berikutnya
      setTimeout(() => {
         triggerSubmissionWorker().catch(() => {});
      }, 2000);
      return;
    }

    // Check roboneo history to find result_media_info if not yet found in history-detail
    if (!foundMediaUrl && job.roomId) {
      try {
        const histListRes = await runCLI(['history'], activeKeyObj.key, {}, 10000);
        if (histListRes.code === 0) {
          const parsedHist = parseCLIJsonOutput(histListRes.stdout);
          if (Array.isArray(parsedHist.list)) {
            const currentRoom = parsedHist.list.find((r: any) => r.room_id === job.roomId);
            if (currentRoom?.last_task_media_info?.result_media_info?.media_items) {
              const resItems = currentRoom.last_task_media_info.result_media_info.media_items;
              const v = resItems.find((x: any) => job.jobType === 'image' ? (x.media_type === 'image' || x.media_type === 'photo') : (x.media_type === 'video' || (x.duration && x.duration > 0))) || resItems[0];
              if (v && (v.media_url || v.ori_media_url)) {
                foundMediaUrl = v.media_url || v.ori_media_url;
                logStatus(job.id, '[RESULT MEDIA FOUND IN HISTORY]', foundMediaUrl);
              }
            }
          }
        }
      } catch (e) {}
    }

    // Auto-reply if RoboNeo asks to continue
    if (action === 'reply') {
      let lastRequestId = pollData.last_request_id || pollData.requestId || '';
      if (!lastRequestId && Array.isArray(pollData.items)) {
        for (const item of pollData.items) {
          if (item?.id?.startsWith('BLOCK_') || item?.request_id || item?.id) {
            lastRequestId = item.id || item.request_id;
          }
        }
      }
      logStatus(job.id, '[POLL] next_action', 'reply required -> sending continue reply');
      if (lastRequestId) {
        await runCLI(['reply', '-r', job.roomId, '-p', 'continue', '--last-request-id', lastRequestId], activeKeyObj.key, {}, 15000);
      } else {
        await runCLI(['reply', '-r', job.roomId, '-p', 'continue'], activeKeyObj.key, {}, 15000);
      }
      return;
    }

    // Auto-rotate if room remains completely empty after 8 polling attempts (40s)
    const hasAnyItems = Array.isArray(pollData.items) && pollData.items.length > 0;
    if (!foundMediaUrl && !hasAnyItems && (job.pollAttempt || 0) >= 8) {
      logStatus(job.id, '[EMPTY ROOM ROTATION]', `Room ${job.roomId} tidak menerima prompt dari server RoboNeo. Merotasi akun dan mengirim ulang...`);
      job.roomId = undefined;
      job.status = 'QUEUED';
      job.error = undefined;
      job.errorMessage = undefined;
      job.attemptCount = (job.attemptCount || 0) + 1;
      saveJobs();
      setTimeout(() => {
        triggerSubmissionWorker().catch(() => {});
      }, 2000);
      return;
    }

    // Check completion condition - only finalize when genuine video URL is found or action is done with media
    const isCompleted = !!foundMediaUrl || (action === 'done' && artifactList.length > 0);
    
    if (isCompleted) {
      if (foundMediaUrl) job.resultUrl = foundMediaUrl;
      logStatus(job.id, '[POLL] status', 'COMPLETED -> Triggering Download');
      logStatus(job.id, '[POLL] done', foundMediaUrl || 'Artifact ready in room');
      await finalizeJobSuccess(job, foundMediaUrl || undefined);
      return;
    }

    // Check if existing output already downloaded in directory
    const outputDir = path.join(DIRS.jobsOutput, job.id);
    const filesInDir = getAllFilesRecursive(outputDir);
    const isImg = job.jobType === 'image';
    const existingFile = isImg ? filesInDir.find(f => /\.(jpg|jpeg|png|webp)$/i.test(f) && fs.statSync(f).size > 1000) : filesInDir.find(f => /\.(mp4|webm|mov)$/i.test(f) && fs.statSync(f).size > 1000);
    if (existingFile && (isImg || !isSameAsInputReferenceVideo(job, existingFile))) {
      logStatus(job.id, '[POLL] found local generated output', existingFile);
      await finalizeJobSuccess(job);
      return;
    }

    // If still within 12-minute window, keep waiting and polling!
    if (Date.now() < (job.timeoutAt || (Date.now() + 12 * 60 * 1000))) {
      logStatus(job.id, '[POLL WAIT]', 'Status cloud sedang memproses hasil render gambar...');
      return;
    }

    job.status = 'Failed';
    job.errorCategory = 'INTERNAL_ERROR';
    job.errorMessage = isImg ? 'RoboNeo tidak menghasilkan gambar setelah batas waktu maksimal 12 menit.' : 'RoboNeo tidak menghasilkan video setelah batas waktu maksimal 12 menit.';
    job.error = job.errorMessage;
    logStatus(job.id, '[POLL FAILED]', job.errorMessage);
    saveJobs();
    return;

    logStatus(job.id, '[POLL] status', 'PROCESSING');
  } catch (err: any) {
    console.error(`[POLL JOB ERROR] for ${job.id}:`, err);
  }
}

// Background poll loop every 3 seconds & periodic key sync
let lastKeySyncTime = 0;
setInterval(() => {
  pollProcessingJobs().catch(e => console.error('[POLL INTERVAL ERROR]', e));
  triggerSubmissionWorker().catch(e => console.error('[SUBMISSION TRIGGER ERROR]', e));

  // Sync keys from cloud every 2 minutes
  if (Date.now() - lastKeySyncTime > 120000) {
    lastKeySyncTime = Date.now();
    const readyOrInvalidKeys = Array.from(keys.values());
    for (const k of readyOrInvalidKeys) {
      refreshKeyCredits(k).catch(() => {});
    }
  }
}, 3000);

// ==========================================
// API ENDPOINTS
// ==========================================

// 1. User & Auth Endpoints
app.post('/api/auth/user-login', (req, res) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string') return res.status(400).json({ error: 'Kode akses tidak valid.' });
    const cleanCode = code.trim().toUpperCase();
    const codeEntry = Array.from(accessCodes.values()).find(c => c.code.trim().toUpperCase() === cleanCode);

    if (!codeEntry || codeEntry.status !== 'active') {
      return res.status(403).json({ error: 'Kode akses tidak valid atau tidak aktif.' });
    }

    codeEntry.lastUsedAt = Date.now();
    saveAccessCodes();

    const sessionToken = uuidv4();
    userSessions.set(sessionToken, {
      codeId: codeEntry.id,
      userLabel: codeEntry.userLabel,
      code: codeEntry.code
    });

    res.json({
      success: true,
      token: sessionToken,
      user: {
        id: codeEntry.id,
        userLabel: codeEntry.userLabel,
        hasApiKey: Boolean(codeEntry.userApiKey),
        maskedApiKey: maskApiKey(codeEntry.userApiKey)
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', (req, res) => {
  const token = getAuthToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const session = userSessions.get(token);
  if (!session) return res.status(401).json({ error: 'Session expired' });

  const entry = accessCodes.get(session.codeId);
  if (!entry || entry.status !== 'active') return res.status(403).json({ error: 'Account disabled' });

  res.json({
    id: entry.id,
    userLabel: entry.userLabel,
    code: entry.code,
    hasApiKey: Boolean(entry.userApiKey),
    maskedApiKey: maskApiKey(entry.userApiKey)
  });
});

app.post('/api/auth/logout', (req, res) => {
  const token = getAuthToken(req);
  if (token) userSessions.delete(token);
  res.json({ success: true });
});

// 2. Health & Central Config Endpoints
app.get('/api/config', (req, res) => {
  res.json({
    centralBackend: true,
    version: '2.6',
    appUrl: process.env.APP_URL || '',
    status: 'ONLINE'
  });
});

app.get('/api/health', (req, res) => {
  let cliAvailable = false;
  try {
    getCLICommand();
    cliAvailable = true;
  } catch (e) {
    cliAvailable = false;
  }

  const eligibleKeys = getEligibleAccounts(undefined, 15);
  const queuedCount = Array.from(jobs.values()).filter(j => j.status === 'QUEUED' || j.status === 'Waiting').length;
  const processingCount = Array.from(jobs.values()).filter(j => j.status === 'PROCESSING' || j.status === 'ROBO_NEO_PROCESSING').length;

  res.json({ 
    ok: true,
    backend: 'ONLINE',
    persistentStorage: fs.existsSync(DIRS.storageMediaImages) && fs.existsSync(DIRS.storageMediaVideos) ? 'ONLINE' : 'DEGRADED',
    database: fs.existsSync(jobsFile) ? 'ONLINE' : 'ONLINE',
    roboneoCli: cliAvailable ? 'AVAILABLE' : 'NOT_AVAILABLE',
    accountPool: isSyncingCarrots ? 'SYNCING' : 'SYNCED',
    eligibleAccounts: eligibleKeys.length,
    totalAccounts: keys.size,
    activeSubmissions: activeSubmissionJobIds.size,
    activeProcessing: processingCount,
    queueLength: queuedCount,
    queue: 'HEALTHY'
  });
});

// 3. Keys Endpoints
app.get('/api/keys', (req, res) => {
  res.json(Array.from(keys.values()));
});

app.post('/api/keys/bulk', async (req, res) => {
  try {
    const { keys: inputKeys } = req.body;
    if (!Array.isArray(inputKeys)) return res.status(400).json({ error: 'Expected array of keys' });

    const results = [];
    for (const k of inputKeys) {
      const trimmed = k.trim();
      if (!trimmed) continue;

      const existing = Array.from(keys.values()).find(item => item.key === trimmed);
      if (existing) {
        results.push({ key: trimmed, status: 'Duplicate' });
        continue;
      }

      const id = uuidv4();
      const keyObj: AccessKey = {
        id,
        key: trimmed,
        status: 'Validating',
        lastChecked: Date.now(),
        usageCount: 0,
        logs: []
      };
      keys.set(id, keyObj);

      validateKey(trimmed).then(resVal => {
        keyObj.nickname = resVal.nickname;
        if (resVal.carrots !== undefined) keyObj.carrots = resVal.carrots;
        keyObj.status = resVal.valid ? 'Ready' : 'Invalid';
        keyObj.error = resVal.valid ? undefined : resVal.error;
        keyObj.lastChecked = Date.now();
        saveKeys();
      }).catch(() => {});

      results.push({ key: trimmed, status: 'Added' });
    }
    
    saveKeys();
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/keys', (req, res) => {
  keys.clear();
  saveKeys();
  res.json({ success: true, message: 'All keys deleted successfully' });
});

app.delete('/api/keys/:id', (req, res) => {
  if (keys.delete(req.params.id)) {
    saveKeys();
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Key not found' });
  }
});

app.post('/api/keys/sync-carrots', async (req, res) => {
  if (isSyncingCarrots) {
    return res.status(400).json({ error: 'Sync process already running' });
  }

  const allKeys = Array.from(keys.values());
  isSyncingCarrots = true;

  const runSync = async () => {
    for (const k of allKeys) {
      try {
        const result = await validateKey(k.key);
        if (result.valid) {
          k.carrots = result.carrots;
          k.nickname = result.nickname;
          k.status = 'Ready';
          k.error = undefined;
        } else {
          k.error = result.error;
        }
        k.lastChecked = Date.now();
      } catch (e) {}
      saveKeys();
    }
    isSyncingCarrots = false;
  };

  runSync().catch(() => { isSyncingCarrots = false; });
  res.json({ success: true, message: 'Sync started' });
});

app.post('/api/keys/:id/validate', async (req, res) => {
  const keyObj = keys.get(req.params.id);
  if (!keyObj) return res.status(404).json({ error: 'Key not found' });

  keyObj.status = 'Validating';
  const result = await validateKey(keyObj.key);
  keyObj.nickname = result.nickname || keyObj.nickname;
  if (result.carrots !== undefined) keyObj.carrots = result.carrots;
  keyObj.status = result.valid ? 'Ready' : 'Invalid';
  keyObj.error = result.valid ? undefined : result.error;
  keyObj.lastChecked = Date.now();
  saveKeys();
  res.json(keyObj);
});

// 4. Job Creation Endpoint (Fast Async Submission)
app.post('/api/jobs', upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'refImages', maxCount: 6 }
]), async (req, res) => {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] };
  const { prompt, autoUpscale, selectedModel, resolution, quality, aspectRatio } = req.body;

  const type = 'image';

  if (!files?.image) {
    return res.status(400).json({ error: 'Missing source image' });
  }

  const imgUpload = files.image[0];
  const refUploads = files.refImages || [];

  const jobId = uuidv4();
  const isAutoUpscale = autoUpscale === 'true' || autoUpscale === true;

  // Move files to Persistent Storage
  const persistentImgPath = path.join(DIRS.storageMediaImages, `${jobId}-${imgUpload.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  
  const persistentRefPaths: string[] = [];
  try {
    fs.copyFileSync(imgUpload.path, persistentImgPath);
    
    // Copy reference images if any
    for (let i = 0; i < refUploads.length; i++) {
      const refFile = refUploads[i];
      const safeName = refFile.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const refPath = path.join(DIRS.storageMediaImages, `${jobId}-ref-${i}-${safeName}`);
      fs.copyFileSync(refFile.path, refPath);
      persistentRefPaths.push(refPath);
    }
  } catch (e: any) {
    return res.status(500).json({ error: `Failed to persist media: ${e.message}` });
  }

  const imgChecksum = calculateFileChecksum(persistentImgPath);
  
  // Calculate dynamic carrot cost
  let costCarrots = 15;
  if (selectedModel === 'banana_pro') {
    costCarrots = resolution === '4K' ? 46 : 26;
  } else if (selectedModel === 'gpt_image_2') {
    costCarrots = quality === 'high' ? 41 : 11;
  }

  let modelName = '';
  if (selectedModel === 'banana_pro') modelName = 'Nano Banana Pro (RoboNeo)';
  else if (selectedModel === 'banana_2') modelName = 'Nano Banana 2 (RoboNeo)';
  else if (selectedModel === 'gpt_image_2') modelName = 'GPT Image 2 (RoboNeo)';

  const initialLogs = [
    `[JOB INITIALIZED] Stored in Persistent Storage. Status: QUEUED`,
    `[MEDIA CHECKSUM] Image SHA256: ${imgChecksum.slice(0, 12)}`,
    modelName ? `[MODEL TERPILIH] ${modelName}` : `[MODEL TERPILIH] Standard Style-Transfer`,
  ];

  if (aspectRatio) {
    initialLogs.push(`[ASPECT RATIO] ${aspectRatio}`);
  }
  if (resolution && selectedModel === 'banana_pro') {
    initialLogs.push(`[RESOLUSI] ${resolution}`);
  }
  if (quality && selectedModel === 'gpt_image_2') {
    initialLogs.push(`[KUALITAS] ${quality.toUpperCase()}`);
  }

  if (persistentRefPaths.length > 0) {
    initialLogs.push(`[MEDIA REFERENSI] Berhasil memuat ${persistentRefPaths.length} gambar referensi tambahan (opsional).`);
  }

  initialLogs.push(`[IMAGE-TO-IMAGE AKTIF] Total: ${costCarrots} 🥕`);

  const job: Job = {
    id: jobId,
    status: 'QUEUED',
    createdAt: Date.now(),
    maxSeq: 0,
    jobType: type,
    selectedModel: selectedModel as any,
    costCarrots: costCarrots,
    resolution: resolution as any,
    quality: quality as any,
    aspectRatio: aspectRatio as any,
    sourceImage: persistentImgPath,
    imageStoragePath: persistentImgPath,
    imageSize: imgUpload.size,
    imageMime: imgUpload.mimetype,
    imageHash: imgChecksum,
    refImages: persistentRefPaths.length > 0 ? persistentRefPaths : undefined,
    prompt: prompt,
    autoUpscale: isAutoUpscale,
    logs: initialLogs
  };

  jobs.set(jobId, job);
  saveJobs();

  // Trigger submission worker immediately (non-blocking)
  triggerSubmissionWorker();

  // Fast response
  res.json({ jobId, status: 'QUEUED' });
});

// 5. Job Operations
app.get('/api/jobs', (req, res) => {
  cleanExpiredJobs();
  res.json(Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt));
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.delete('/api/jobs/:id', (req, res) => {
  const success = deleteJobById(req.params.id);
  if (!success) return res.status(404).json({ error: 'Job not found' });
  res.json({ success: true, message: 'Job deleted' });
});

app.delete('/api/jobs', (req, res) => {
  const statusFilter = req.query.status as string;
  let deletedCount = 0;

  for (const [id, job] of Array.from(jobs.entries())) {
    if (!statusFilter || statusFilter === 'all' || job.status.toLowerCase() === statusFilter.toLowerCase()) {
      if (deleteJobById(id)) {
        deletedCount++;
      }
    }
  }

  res.json({ success: true, count: deletedCount });
});

app.post('/api/jobs/sync', async (req, res) => {
  try {
    await pollProcessingJobs();
    triggerSubmissionWorker();
    const readyKeys = Array.from(keys.values());
    for (const k of readyKeys) {
      refreshKeyCredits(k).catch(() => {});
    }
    res.json({ success: true, message: 'Cloud sync triggered' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/jobs/:id/retry', (req, res) => {
  const { id } = req.params;
  const job = jobs.get(id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  job.status = 'QUEUED';
  job.error = undefined;
  job.errorCategory = undefined;
  job.attemptCount = 0;
  job.accountRotations = 0;
  job.timeoutAt = undefined;
  job.roomId = undefined;
  job.logs.push(`[${new Date().toISOString()}] [RETRY TRIGGERED] Re-queued for execution.`);
  saveJobs();

  triggerSubmissionWorker();
  res.json({ success: true, job });
});

app.post('/api/jobs/:id/upscale', async (req, res) => {
  const { id } = req.params;
  const job = jobs.get(id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'Completed' || !job.artifacts || job.artifacts.length === 0) {
    return res.status(400).json({ error: 'Job must be completed with video output before upscaling' });
  }

  const rawVideoArtifact = job.artifacts.find(a => /\.(mp4|mov|webm)$/i.test(a) && !a.includes('upscaled_2k_')) || job.artifacts[0];
  const localInputPath = toLocalPath(rawVideoArtifact);

  if (!fs.existsSync(localInputPath)) {
    return res.status(404).json({ error: 'Video file does not exist on disk' });
  }

  const dir = path.dirname(localInputPath);
  const ext = path.extname(localInputPath) || '.mp4';
  const baseName = path.basename(localInputPath, ext).replace(/^clean_/, '');
  const upscaledFileName = `upscaled_2k_${baseName}${ext}`;
  const upscaledFilePath = path.join(dir, upscaledFileName);

  const upscaleJobId = `upscale_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const upscaleJob: Job = {
    id: upscaleJobId,
    status: 'Upscaling 2K',
    createdAt: Date.now(),
    maxSeq: 1,
    jobType: 'upscale',
    parentJobId: id,
    costCarrots: 1,
    prompt: `Upscale 2K Ultra HD (Ref: ${id.slice(0, 8)})`,
    sourceImage: job.sourceImage,
    keyId: job.keyId,
    autoUpscale: true,
    logs: [
      `[MANUAL UPSCALE 2K START] Parent Motion Job: ${id}`,
      `[BIAYA UPSCALE] +1 Kredit`
    ]
  };
  jobs.set(upscaleJobId, upscaleJob);
  saveJobs();

  try {
    const upscaleResult = await upscaleVideoTo2K(localInputPath, upscaledFilePath);
    if (upscaleResult.success) {
      const webUpscaledPath = toWebPath(upscaledFilePath);
      upscaleJob.upscaledArtifact = webUpscaledPath;
      upscaleJob.resolution = `${upscaleResult.width}x${upscaleResult.height} (2K Ultra HD)`;
      upscaleJob.artifacts = [webUpscaledPath];
      upscaleJob.status = 'Completed';
      job.upscaledArtifact = webUpscaledPath;
      saveJobs();
      res.json({ success: true, job: upscaleJob });
    } else {
      upscaleJob.status = 'Failed';
      upscaleJob.error = upscaleResult.error || 'Failed to upscale video';
      saveJobs();
      res.status(500).json({ error: upscaleResult.error || 'Failed to upscale video' });
    }
  } catch (err: any) {
    upscaleJob.status = 'Failed';
    upscaleJob.error = err.message;
    saveJobs();
    res.status(500).json({ error: err.message });
  }
});

// 6. Media HTTP 206 Partial Streaming Handler
function serveMediaWithRanges(req: express.Request, res: express.Response, baseDir: string) {
  const relativePath = decodeURIComponent(req.path.replace(/^\//, ''));
  const filePath = path.join(process.cwd(), baseDir, relativePath);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return res.status(404).send('File not found');
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const ext = path.extname(filePath).toLowerCase();

  let contentType = 'application/octet-stream';
  if (ext === '.mp4') contentType = 'video/mp4';
  else if (ext === '.webm') contentType = 'video/webm';
  else if (ext === '.mov') contentType = 'video/quicktime';
  else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
  else if (ext === '.png') contentType = 'image/png';
  else if (ext === '.webp') contentType = 'image/webp';

  const range = req.headers.range;
  if (range && (contentType.startsWith('video/') || contentType.startsWith('audio/'))) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (isNaN(end) || end >= fileSize) {
      end = fileSize - 1;
    }

    if (isNaN(start) || start < 0 || start >= fileSize || start > end) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
      return res.end();
    }

    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400',
    };
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  }
}

app.use('/outputs', (req, res) => serveMediaWithRanges(req, res, 'outputs'));
app.use('/downloads', (req, res) => serveMediaWithRanges(req, res, 'downloads'));
app.use('/uploads', (req, res) => serveMediaWithRanges(req, res, 'uploads'));
app.use('/storage', (req, res) => serveMediaWithRanges(req, res, 'storage'));

// ==========================================
// STARTUP RECOVERY & SERVER LAUNCH
// ==========================================

function resumePendingJobs() {
  console.log(`[STARTUP RECOVERY] Checking jobs state...`);
  const now = Date.now();
  for (const [id, job] of Array.from(jobs.entries())) {
    // If job was completed or failed, keep as is
    if (job.status === 'Completed' || job.status === 'Failed') continue;

    // Check if job expired while server was down
    if (job.timeoutAt && now > job.timeoutAt) {
      job.status = 'Failed';
      job.errorCategory = 'TIMEOUT';
      job.errorMessage = 'Job expired prior to server restart.';
      job.error = job.errorMessage;
      logStatus(job.id, '[RECOVERY] job expired prior to restart');
      saveJobs();
      continue;
    }

    // Check media availability
    const mediaCheck = validateJobMedia(job);
    if (!mediaCheck.valid && !job.roomId) {
      job.status = 'Failed';
      job.errorCategory = 'MEDIA_ERROR';
      job.errorMessage = 'File media tidak ditemukan setelah restart. Silakan upload ulang.';
      job.error = job.errorMessage;
      logStatus(job.id, '[RECOVERY] media missing', job.error);
      saveJobs();
      continue;
    }

    // If job has a roomId, keep in PROCESSING state so Polling Worker resumes tracking seamlessly
    if (job.roomId) {
      job.status = 'PROCESSING';
      job.nextPollAt = Date.now(); // Resume polling immediately
      if (!job.timeoutAt) job.timeoutAt = Date.now() + 12 * 60 * 1000;
      logStatus(job.id, '[RECOVERY] resumed processing job', `Room ID: ${job.roomId}`);
      saveJobs();
    } else {
      // Re-queue
      job.status = 'QUEUED';
      logStatus(job.id, '[RECOVERY] re-queued job without room_id');
      saveJobs();
    }
  }

  // Trigger submission worker for any QUEUED jobs
  triggerSubmissionWorker();
}

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`[PRODUCTION SERVER] Running on http://localhost:${PORT}`);

    // Startup recovery
    resumePendingJobs();

    // Refresh all Ready keys on startup
    const readyKeys = Array.from(keys.values()).filter(k => k.status === 'Ready');
    for (const k of readyKeys) {
      validateKey(k.key).then(res => {
        if (res.valid) {
          k.carrots = res.carrots;
          k.nickname = res.nickname;
          k.status = 'Ready';
          k.lastChecked = Date.now();
          saveKeys();
        }
      }).catch(() => {});
    }
  });
}

startServer();

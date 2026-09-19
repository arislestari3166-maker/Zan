/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type JobStatus = 
  | 'QUEUED'
  | 'VALIDATING'
  | 'MEDIA_READY'
  | 'PREPROCESSING'
  | 'ACCOUNT_SELECTING'
  | 'SUBMITTING'
  | 'PROCESSING'
  | 'ROBO_NEO_PROCESSING'
  | 'Downloading'
  | 'Upscaling 2K'
  | 'Completed'
  | 'Failed'
  | 'Waiting'
  | 'Uploading'
  | 'Creating Room'
  | 'Processing';

export type KeyStatus = 'Ready' | 'Busy' | 'Reserved' | 'Invalid' | 'Disabled' | 'Validating';

export interface AccessKey {
  id: string;
  key: string;
  status: KeyStatus;
  lastChecked: number;
  error?: string;
  usageCount: number;
  logs: string[];
  nickname?: string;
  carrots?: number;
}

export interface Job {
  id: string;
  roomId?: string;
  status: JobStatus;
  createdAt: number;
  maxSeq: number;
  error?: string;
  errorCategory?: 'MEDIA_ERROR' | 'ROBO_NEO_BUSY' | 'NETWORK_ERROR' | 'AUTH_ERROR' | 'INSUFFICIENT_CARROTS' | 'INTERNAL_ERROR' | 'TIMEOUT' | 'ROOM_ERROR';
  
  // Persistent Media Storage fields
  sourceImage?: string;
  imageStoragePath?: string;
  processedImagePath?: string;
  refImages?: string[];
  processedRefImages?: string[];
  imageSize?: number;
  imageMime?: string;
  imageHash?: string;
  
  // Execution metadata & Per-Job Lifecycle State
  attemptCount?: number;
  retryCount?: number;
  accountRotations?: number;
  selectedAccountId?: string;
  selectedAccountNickname?: string;
  selectedAccountCarrots?: number;
  
  // Per-job Polling & Timeout Engine State
  pollAttempt?: number;
  lastPolledAt?: number;
  nextPollAt?: number;
  startedAt?: number;
  timeoutAt?: number;
  resultUrl?: string;
  errorCode?: string | number;
  errorMessage?: string;

  progress?: number;
  trimmedVideo?: string;
  prompt?: string;
  autoUpscale?: boolean;
  jobType?: 'upscale' | 'image';
  selectedModel?: 'banana_pro' | 'banana_2' | 'gpt_image_2';
  costCarrots?: number;
  parentJobId?: string;
  upscaledArtifact?: string;
  resolution?: string;
  quality?: string;
  aspectRatio?: string;
  artifacts?: string[];
  keyId?: string;
  logs: string[];
}

export interface PollResponse {
  next_action: any; // Can be string or object
  max_seq: number;
  output?: any;
  items?: any[];
}

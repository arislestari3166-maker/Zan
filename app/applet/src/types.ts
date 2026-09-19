/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type JobStatus = 
  | 'Waiting'
  | 'Uploading'
  | 'Creating Room'
  | 'Processing'
  | 'Downloading'
  | 'Upscaling 2K'
  | 'Completed'
  | 'Failed';

export type KeyStatus = 'Ready' | 'Busy' | 'Invalid' | 'Disabled' | 'Validating';

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
  sourceImage?: string;
  refVideo?: string;
  trimmedVideo?: string;
  prompt?: string;
  autoUpscale?: boolean;
  jobType?: 'motion' | 'upscale';
  costCarrots?: number;
  parentJobId?: string;
  upscaledArtifact?: string;
  resolution?: string;
  artifacts?: string[];
  keyId?: string;
  logs: string[];
  userCode?: string;
}

export interface PollResponse {
  next_action: any;
  max_seq: number;
  output?: any;
  items?: any[];
}

export interface AccessCode {
  id: string;
  userLabel: string;
  code: string;
  status: 'active' | 'inactive';
  createdAt: number;
  lastUsedAt: number | null;
  hasApiKey?: boolean;
  maskedApiKey?: string | null;
}

export interface UserSession {
  role: 'user';
  userLabel: string;
  code: string;
  hasApiKey: boolean;
  maskedApiKey: string | null;
  token: string;
}

export interface AdminSession {
  role: 'admin';
  token: string;
}

export type AuthState = UserSession | AdminSession | null;

import type { AIModel } from './types.js';
import type { PublicErrorCode } from './public-errors.js';

export const CHATGPT_CONSENT_VERSION = '2026-10-24';
export const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage';
export interface ChatGPTState {
  status: 'disconnected' | 'checking' | 'ready' | 'needs-consent' | 'error';
  accounts: { id: string; label: string; connected: boolean }[];
  activeAccountId: string | null;
  models: AIModel[];
  locked?: boolean;
  signingIn?: boolean;
  firstUsePending: boolean;
  error?: PublicErrorCode;
  diagnostic?: { phase: 'authorization' | 'request' | 'stream'; status?: number; code?: string; param?: string; requestId?: string;
    contentType?: string; bodyFormat?: 'json' | 'event-stream' | 'html' | 'other' | 'empty' };
}

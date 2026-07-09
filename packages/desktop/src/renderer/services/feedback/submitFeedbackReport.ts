import { createApiClient } from '../../api/client';
import { getCloudApiBase } from '../../api/config';

const LOG_PREFIX = '[FeedbackReport]';
type FeedbackLogLevel = 'info' | 'warn' | 'error';
type FeedbackLogAttachmentStatus = 'collected' | 'empty' | 'failed' | 'skipped' | 'unavailable';

export type FeedbackAttachment = {
  filename: string;
  data: Uint8Array<ArrayBuffer>;
  contentType: string;
};

export type FeedbackEventTags = Record<string, string>;
export type FeedbackEventExtra = Record<string, unknown>;

export type SubmitFeedbackReportInput = {
  attachments?: FeedbackAttachment[];
  collectLogs?: boolean;
  description: string;
  extra?: FeedbackEventExtra;
  flushTimeoutMs?: number;
  module: string;
  moduleLabel: string;
  tags?: FeedbackEventTags;
};

type AdminFeedbackAttachment = {
  filename: string;
  contentType: string;
  size: number;
  dataBase64: string;
};

type AdminFeedbackResponse = {
  success: boolean;
  report?: {
    id: string;
  };
};

function uint8ArrayToBase64(data: Uint8Array): string {
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let index = 0; index < data.byteLength; index += chunkSize) {
    const chunk = data.subarray(index, index + chunkSize);
    chunks.push(String.fromCharCode(...chunk));
  }
  return btoa(chunks.join(''));
}

function toAdminFeedbackAttachments(attachments: FeedbackAttachment[]): AdminFeedbackAttachment[] {
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    contentType: attachment.contentType,
    size: attachment.data.byteLength,
    dataBase64: uint8ArrayToBase64(attachment.data),
  }));
}

function summarizeAttachments(attachments: FeedbackAttachment[]): Array<{
  contentType: string;
  filename: string;
  size: number;
}> {
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    contentType: attachment.contentType,
    size: attachment.data.byteLength,
  }));
}

function summarizeLogAttachment(
  status: FeedbackLogAttachmentStatus,
  attachment: FeedbackAttachment | null
): {
  filename?: string;
  size?: number;
  status: FeedbackLogAttachmentStatus;
} {
  if (!attachment) {
    return { status };
  }

  return {
    status,
    filename: attachment.filename,
    size: attachment.data.byteLength,
  };
}

function normalizeLogDetails(details: unknown): unknown {
  if (details instanceof Error) {
    return {
      name: details.name,
      message: details.message,
      stack: details.stack,
    };
  }
  return details;
}

export function logFeedbackReport(level: FeedbackLogLevel, message: string, details?: unknown): void {
  const normalizedDetails = normalizeLogDetails(details);
  const consoleMessage = `${LOG_PREFIX} ${message}`;
  if (level === 'error') {
    console.error(consoleMessage, normalizedDetails);
  } else if (level === 'warn') {
    console.warn(consoleMessage, normalizedDetails);
  } else {
    console.info(consoleMessage, normalizedDetails);
  }

  try {
    window.electronAPI?.logFeedbackEvent?.({
      level,
      message,
      details: normalizedDetails,
    });
  } catch {
    // Renderer console logging above is the fallback.
  }
}

async function collectLogAttachment(): Promise<{
  attachment: FeedbackAttachment | null;
  status: FeedbackLogAttachmentStatus;
}> {
  try {
    const electronAPI = typeof window === 'undefined' ? undefined : window.electronAPI;
    if (!electronAPI?.collectFeedbackLogs) {
      return { attachment: null, status: 'unavailable' };
    }

    const logData = await electronAPI?.collectFeedbackLogs?.();
    if (!logData) {
      return { attachment: null, status: 'empty' };
    }

    return {
      attachment: {
        filename: logData.filename,
        data: new Uint8Array(logData.data),
        contentType: 'application/gzip',
      },
      status: 'collected',
    };
  } catch {
    return { attachment: null, status: 'failed' };
  }
}

function normalizeDescription(description: string): string {
  return description.trim().replace(/\s+/g, ' ');
}

async function submitToAdminFeedback(input: SubmitFeedbackReportInput, description: string, attachments: FeedbackAttachment[]) {
  const api = createApiClient(getCloudApiBase());
  return api.post<AdminFeedbackResponse>('/api/feedback/reports', {
    module: input.module,
    moduleLabel: input.moduleLabel,
    description,
    tags: input.tags ?? {},
    extra: input.extra ?? {},
    attachments: toAdminFeedbackAttachments(attachments),
    appVersion: typeof input.extra?.appVersion === 'string' ? input.extra.appVersion : undefined,
    platform: typeof navigator === 'undefined' ? undefined : navigator.platform,
  });
}

export async function submitFeedbackReport(input: SubmitFeedbackReportInput): Promise<void> {
  const attachments = [...(input.attachments ?? [])];
  let adminReportId: string | undefined;
  let logAttachmentStatus: FeedbackLogAttachmentStatus = input.collectLogs ? 'empty' : 'skipped';
  let logAttachment: FeedbackAttachment | null = null;

  try {
    if (input.collectLogs) {
      const collectedLogAttachment = await collectLogAttachment();
      logAttachmentStatus = collectedLogAttachment.status;
      logAttachment = collectedLogAttachment.attachment;
      if (logAttachment) {
        attachments.unshift(logAttachment);
      }
    }

    const normalizedDescription = normalizeDescription(input.description);
    const adminResponse = await submitToAdminFeedback(input, normalizedDescription, attachments);
    if (!adminResponse.success) {
      throw new Error('Failed to submit feedback report to admin backend');
    }
    adminReportId = adminResponse.report?.id;

    logFeedbackReport('info', 'submitted', {
      module: input.module,
      adminReportId,
      collectLogs: Boolean(input.collectLogs),
      logAttachment: summarizeLogAttachment(logAttachmentStatus, logAttachment),
      attachmentCount: attachments.length,
      attachments: summarizeAttachments(attachments),
      flushTimeoutMs: input.flushTimeoutMs,
      tagKeys: Object.keys(input.tags ?? {}),
    });
  } catch (error) {
    logFeedbackReport('error', 'failed', {
      module: input.module,
      adminReportId,
      collectLogs: Boolean(input.collectLogs),
      logAttachment: summarizeLogAttachment(logAttachmentStatus, logAttachment),
      attachmentCount: attachments.length,
      attachments: summarizeAttachments(attachments),
      flushTimeoutMs: input.flushTimeoutMs,
      error,
    });
    throw error;
  }
}

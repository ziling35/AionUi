import type { ThoughtData } from '@/renderer/components/chat/ThoughtDisplay';

export type AionrsToolCallData = {
  call_id?: unknown;
  name?: unknown;
  status?: unknown;
  description?: unknown;
  input?: unknown;
  args?: unknown;
};

export type AionrsToolCallProgress = {
  hasActiveTools: boolean;
  transitionedToWaiting: boolean;
  thought?: ThoughtData;
};

type ToolCallStatus = 'running' | 'completed' | 'error' | 'unknown';

const TOOL_SUBJECTS: Record<string, string> = {
  Glob: 'Finding files',
  Grep: 'Searching code',
  Read: 'Reading files',
  Edit: 'Editing files',
  Write: 'Writing files',
  ExecCommand: 'Running command',
  Bash: 'Running command',
  Shell: 'Running command',
};

const normalizeToolCallStatus = (status: unknown): ToolCallStatus => {
  if (status === 'running' || status === 'completed' || status === 'error') return status;
  if (typeof status === 'string') {
    const normalized = status.toLowerCase();
    if (normalized === 'running' || normalized === 'completed' || normalized === 'error') return normalized;
    if (normalized === 'in_progress' || normalized === 'executing' || normalized === 'pending') return 'running';
    if (normalized === 'done' || normalized === 'success') return 'completed';
    if (normalized === 'failed' || normalized === 'failure') return 'error';
  }
  return 'unknown';
};

const stringValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const objectValue = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
};

const truncate = (value: string, maxLength = 120): string => {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength - 1)}?` : singleLine;
};

const firstStringField = (input: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = stringValue(input[key]);
    if (value) return value;
  }
  return undefined;
};

const buildInputDescription = (name: string, data: AionrsToolCallData): string | undefined => {
  const input = objectValue(data.input) ?? objectValue(data.args);
  if (!input) return undefined;

  if (name === 'Read' || name === 'Edit' || name === 'Write') {
    return firstStringField(input, ['file_path', 'path', 'file_name']);
  }

  if (name === 'ExecCommand' || name === 'Bash' || name === 'Shell') {
    return firstStringField(input, ['command', 'cmd']);
  }

  if (name === 'Grep') {
    const pattern = firstStringField(input, ['pattern', 'query']);
    const path = firstStringField(input, ['path', 'glob']);
    if (pattern && path) return `"${pattern}" in ${path}`;
    return pattern ?? path;
  }

  if (name === 'Glob') {
    const pattern = firstStringField(input, ['pattern', 'glob']);
    const path = firstStringField(input, ['path']);
    if (pattern && path) return `${pattern} in ${path}`;
    return pattern ?? path;
  }

  return firstStringField(input, ['file_path', 'path', 'command', 'pattern', 'query', 'url']);
};

const getToolDescription = (name: string, data: AionrsToolCallData): string => {
  return truncate(stringValue(data.description) ?? buildInputDescription(name, data) ?? name);
};

export const getAionrsToolThought = (data: AionrsToolCallData): ThoughtData | undefined => {
  const name = stringValue(data.name) ?? 'Tool';
  const description = getToolDescription(name, data);
  const status = normalizeToolCallStatus(data.status);

  if (status === 'running') {
    return {
      subject: TOOL_SUBJECTS[name] ?? 'Using tools',
      description,
    };
  }

  if (status === 'error') {
    return {
      subject: 'Handling tool result',
      description: `${name} returned an error`,
    };
  }

  if (status === 'completed') {
    return {
      subject: 'Reviewing tool results',
      description,
    };
  }

  return undefined;
};

export const updateAionrsToolProgress = (
  activeToolCallIds: Set<string>,
  data: AionrsToolCallData
): AionrsToolCallProgress => {
  const callId = stringValue(data.call_id);
  const status = normalizeToolCallStatus(data.status);
  const wasActive = activeToolCallIds.size > 0;

  if (callId && status === 'running') {
    activeToolCallIds.add(callId);
  } else if (callId && (status === 'completed' || status === 'error')) {
    activeToolCallIds.delete(callId);
  }

  const hasActiveTools = activeToolCallIds.size > 0 || (!callId && status === 'running');
  const transitionedToWaiting = wasActive && !hasActiveTools && (status === 'completed' || status === 'error');

  return {
    hasActiveTools,
    transitionedToWaiting,
    thought: getAionrsToolThought(data),
  };
};

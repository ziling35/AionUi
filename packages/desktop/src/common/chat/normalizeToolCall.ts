import type { IMessageAcpToolCall, IMessageToolCall, IMessageToolGroup } from './chatLib';
import { getAcpImagePath } from './acpToolCallOutput';

export type NormalizedToolStatus = 'pending' | 'running' | 'completed' | 'error' | 'canceled';

export interface NormalizedToolCall {
  key: string;
  name: string;
  status: NormalizedToolStatus;
  description?: string;
  startedAt?: number;
  input?: string;
  output?: string;
  feedback?: NormalizedToolFeedback;
  truncated?: boolean;
  messageId?: string;
  conversationId?: string;
  imagePath?: string;
}

export interface NormalizedToolFeedback {
  kind: string;
  summary: string;
  retryHint?: string;
  stats?: Record<string, unknown>;
  partialResults?: string[];
}

const formatValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const TOOL_FEEDBACK_PATTERN = /<tool_feedback>\s*([\s\S]*?)\s*<\/tool_feedback>/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseToolFeedback = (output: string | undefined): { output?: string; feedback?: NormalizedToolFeedback } => {
  if (!output) return { output };

  const match = output.match(TOOL_FEEDBACK_PATTERN);
  if (!match?.[1]) return { output };

  try {
    const parsed = JSON.parse(match[1]) as unknown;
    if (!isRecord(parsed) || typeof parsed.kind !== 'string' || typeof parsed.summary !== 'string') {
      return { output: output.replace(TOOL_FEEDBACK_PATTERN, '').trim() || undefined };
    }

    const retryHint = typeof parsed.retry_hint === 'string' ? parsed.retry_hint : undefined;
    const stats = isRecord(parsed.stats) ? parsed.stats : undefined;
    const partialResults = Array.isArray(parsed.partial_results)
      ? parsed.partial_results.filter((item): item is string => typeof item === 'string')
      : undefined;

    return {
      output: output.replace(TOOL_FEEDBACK_PATTERN, '').trim() || undefined,
      feedback: {
        kind: parsed.kind,
        summary: parsed.summary,
        retryHint,
        stats,
        partialResults,
      },
    };
  } catch {
    return { output: output.replace(TOOL_FEEDBACK_PATTERN, '').trim() || undefined };
  }
};

// ===== tool_group → NormalizedToolCall[] =====

function normalizeToolGroupStatus(status: string): NormalizedToolStatus {
  switch (status) {
    case 'Success':
      return 'completed';
    case 'Error':
      return 'error';
    case 'Canceled':
      return 'canceled';
    case 'Pending':
      return 'pending';
    case 'Executing':
    case 'Confirming':
    default:
      return 'running';
  }
}

const getResultDisplayText = (
  result_display: IMessageToolGroup['content'][0]['result_display']
): string | undefined => {
  if (!result_display) return undefined;
  if (typeof result_display === 'string') return result_display;
  if ('file_diff' in result_display) return result_display.file_diff;
  if ('img_url' in result_display) return result_display.relative_path || result_display.img_url;
  return undefined;
};

export function normalizeToolGroup(message: IMessageToolGroup): NormalizedToolCall[] {
  if (!Array.isArray(message.content)) return [];
  return message.content.map(({ name, call_id, description, confirmationDetails, status, result_display }) => {
    let desc = typeof description === 'string' ? description.slice(0, 100) : '';
    const type = confirmationDetails?.type;
    if (type === 'edit') desc = confirmationDetails.file_name;
    if (type === 'exec') desc = confirmationDetails.command;
    if (type === 'info') desc = confirmationDetails.urls?.join(';') || confirmationDetails.title;
    if (type === 'mcp') desc = confirmationDetails.server_name + ':' + confirmationDetails.tool_name;

    let input: string | undefined;
    if (confirmationDetails) {
      const { title: _title, type: _type, ...rest } = confirmationDetails;
      if (Object.keys(rest).length) input = formatValue(rest);
    } else if (description) {
      input = description;
    }

    const { output: outputText, feedback } = parseToolFeedback(getResultDisplayText(result_display));
    let imagePath: string | undefined;
    if (typeof outputText === 'string') {
      const match = outputText.match(/saved to:\s*([^\r\n]+?\.(?:png|jpe?g|webp|gif|bmp|tiff|svg))/i);
      if (match && match[1]) {
        imagePath = match[1].trim();
      }
    }

    return {
      key: call_id,
      name,
      status: normalizeToolGroupStatus(status),
      description: desc,
      startedAt: message.created_at,
      input,
      output: outputText,
      feedback,
      imagePath,
    };
  });
}

// ===== acp_tool_call → NormalizedToolCall =====

function normalizeAcpStatus(status: string): NormalizedToolStatus {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'error';
    case 'in_progress':
      return 'running';
    case 'pending':
    default:
      return 'pending';
  }
}

const getStringField = (value: Record<string, unknown> | undefined, keys: string[]): string | undefined => {
  if (!value) return undefined;
  for (const key of keys) {
    const field = value[key];
    if (typeof field === 'string' && field.trim()) return field.trim();
  }
  return undefined;
};

const buildAcpToolName = (update: AcpToolCallUpdateCompat, rawInput?: Record<string, unknown>): string => {
  if (typeof update.title === 'string' && update.title.trim()) return update.title.trim();

  const serverName = getStringField(rawInput, ['server_name', 'serverName', 'server']);
  const toolName = getStringField(rawInput, ['tool_name', 'toolName', 'tool', 'name']);
  if (serverName && toolName) return `${serverName}:${toolName}`;
  if (toolName) return toolName;

  return typeof update.kind === 'string' && update.kind.trim() ? update.kind.trim() : 'tool';
};

const buildParamSummary = (kind: string, rawInput?: Record<string, unknown>): string | undefined => {
  if (!rawInput) return undefined;

  if (kind === 'read' || kind === 'edit') {
    return (rawInput.file_path as string) || (rawInput.path as string) || (rawInput.file_name as string);
  }
  if (kind === 'execute') {
    const command = getStringField(rawInput, ['command']);
    if (command) return command;
  }
  if (kind === 'search' || kind === 'grep') {
    const parts: string[] = [];
    if (rawInput.pattern) parts.push(`"${rawInput.pattern}"`);
    if (rawInput.path) parts.push(`in ${rawInput.path}`);
    else if (rawInput.glob) parts.push(`in ${rawInput.glob}`);
    return parts.length > 0 ? parts.join(' ') : undefined;
  }
  if (kind === 'glob') {
    const parts: string[] = [];
    if (rawInput.pattern) parts.push(`${rawInput.pattern}`);
    if (rawInput.path) parts.push(`in ${rawInput.path}`);
    return parts.length > 0 ? parts.join(' ') : undefined;
  }
  if (kind === 'write') {
    return (rawInput.file_path as string) || (rawInput.path as string);
  }

  for (const key of ['file_path', 'command', 'path', 'pattern', 'query', 'url', 'prompt']) {
    const value = rawInput[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
};

type AcpToolCallUpdateCompat = IMessageAcpToolCall['content']['update'] & {
  session_update?: string;
  raw_input?: Record<string, unknown>;
};

type AcpToolCallContentCompat = IMessageAcpToolCall['content'] & {
  _compact?: {
    truncated?: boolean;
    original_size?: number;
    preview_chars?: number;
  };
  update?: AcpToolCallUpdateCompat;
};

export function normalizeAcpToolCall(message: IMessageAcpToolCall): NormalizedToolCall | undefined {
  const content = message.content as AcpToolCallContentCompat | undefined;
  const update = content?.update;
  if (!update) return undefined;

  const rawInput = update.rawInput ?? update.raw_input;
  const input = rawInput ? formatValue(rawInput) : undefined;

  let output: string | undefined;
  if (Array.isArray(update.content) && update.content.length) {
    output = update.content
      .map((item) => {
        if (item.type === 'content' && item.content?.text) return item.content.text;
        if (item.type === 'diff' && 'path' in item) return `[diff] ${item.path}`;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  const parsedOutput = parseToolFeedback(output);

  const keyParam = buildParamSummary(update.kind, rawInput);

  const imagePath = getAcpImagePath(update);
  return {
    key: update.tool_call_id,
    name: buildAcpToolName(update, rawInput),
    status: normalizeAcpStatus(update.status),
    description: keyParam || (rawInput?.command as string) || update.kind,
    startedAt: message.created_at,
    input,
    output: parsedOutput.output,
    feedback: parsedOutput.feedback,
    truncated: content?._compact?.truncated === true,
    messageId: message.id,
    conversationId: message.conversation_id,
    imagePath,
  };
}

// ===== tool_call → NormalizedToolCall =====

function normalizeToolCallStatus(status?: string): NormalizedToolStatus {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'error':
      return 'error';
    case 'running':
      return 'running';
    default:
      return 'pending';
  }
}

export function normalizeToolCall(message: IMessageToolCall): NormalizedToolCall | undefined {
  const { call_id, name, status, input, output, args, description } = message.content;
  if (!call_id) return undefined;

  const displayInput = input
    ? formatValue(input)
    : args && Object.keys(args).length > 0
      ? formatValue(args)
      : undefined;

  const parsedOutput = parseToolFeedback(output);

  let imagePath: string | undefined;
  if (typeof parsedOutput.output === 'string') {
    const match = parsedOutput.output.match(/saved to:\s*([^\r\n]+?\.(?:png|jpe?g|webp|gif|bmp|tiff|svg))/i);
    if (match && match[1]) {
      imagePath = match[1].trim();
    }
  }

  return {
    key: call_id,
    name,
    status: normalizeToolCallStatus(status),
    description: description || undefined,
    startedAt: message.created_at,
    input: displayInput,
    output: parsedOutput.output,
    feedback: parsedOutput.feedback,
    imagePath,
  };
}

// ===== Unified entry =====

export type ToolMessage = IMessageToolGroup | IMessageAcpToolCall | IMessageToolCall;

export function normalizeToolMessages(messages: ToolMessage[]): NormalizedToolCall[] {
  return messages
    .flatMap((m) => {
      if (m.type === 'tool_group') return normalizeToolGroup(m);
      if (m.type === 'acp_tool_call') return normalizeAcpToolCall(m);
      if (m.type === 'tool_call') return normalizeToolCall(m);
      return undefined;
    })
    .filter((item): item is NormalizedToolCall => item !== undefined);
}

export function hasRunningToolMessages(messages: ToolMessage[]): boolean {
  return messages.some((m) => {
    if (m.type === 'tool_group') {
      return Array.isArray(m.content) && m.content.some((t) => normalizeToolGroupStatus(t.status) === 'running');
    }
    if (m.type === 'acp_tool_call') {
      return m.content?.update && normalizeAcpStatus(m.content.update.status) === 'running';
    }
    if (m.type === 'tool_call') {
      return normalizeToolCallStatus(m.content?.status) === 'running';
    }
    return false;
  });
}

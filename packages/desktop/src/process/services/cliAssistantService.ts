import { execFile, spawn } from 'child_process';
import { mkdtemp, writeFile, chmod } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type {
  CliAssistantCommandResult,
  CliAssistantId,
  CliAssistantLaunchRequest,
  CliAssistantRoutingMode,
  CliAssistantStatus,
} from '@/common/adapter/ipcBridge';

type CliAssistantDefinition = {
  id: CliAssistantId;
  name: string;
  command: string;
  npmPackage: string;
  versionArgs: string[];
  launchModelArg: (modelId: string) => string[];
  routingMode: CliAssistantRoutingMode;
};

const CLI_ASSISTANTS: CliAssistantDefinition[] = [
  {
    id: 'codex',
    name: 'Codex CLI',
    command: 'codex',
    npmPackage: '@openai/codex',
    versionArgs: ['--version'],
    launchModelArg: (modelId) => ['--model', modelId],
    routingMode: 'openai-compatible',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    command: 'claude',
    npmPackage: '@anthropic-ai/claude-code',
    versionArgs: ['--version'],
    launchModelArg: (modelId) => ['--model', modelId],
    routingMode: 'best-effort',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    npmPackage: '@google/gemini-cli',
    versionArgs: ['--version'],
    launchModelArg: (modelId) => ['--model', modelId],
    routingMode: 'best-effort',
  },
];

const getDefinition = (id: CliAssistantId): CliAssistantDefinition => {
  const definition = CLI_ASSISTANTS.find((assistant) => assistant.id === id);
  if (!definition) {
    throw new Error(`Unsupported CLI assistant: ${id}`);
  }
  return definition;
};

const execFileText = (file: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 5000 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(`${stdout}${stderr}`.trim());
    });
  });

const findCommandPath = async (command: string): Promise<string | undefined> => {
  try {
    const output =
      process.platform === 'win32'
        ? await execFileText('where.exe', [command])
        : await execFileText('which', [command]);
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
  } catch {
    return undefined;
  }
};

const readVersion = async (definition: CliAssistantDefinition): Promise<string | undefined> => {
  try {
    const output = await execFileText(definition.command, definition.versionArgs);
    return output.split(/\r?\n/)[0]?.trim();
  } catch {
    return undefined;
  }
};

export const listCliAssistants = async (): Promise<CliAssistantStatus[]> => {
  return Promise.all(
    CLI_ASSISTANTS.map(async (definition) => {
      const executablePath = await findCommandPath(definition.command);
      const version = executablePath ? await readVersion(definition) : undefined;
      return {
        id: definition.id,
        name: definition.name,
        command: definition.command,
        installed: Boolean(executablePath),
        version,
        executablePath,
        installCommand: `npm install -g ${definition.npmPackage}`,
        routingMode: definition.routingMode,
      };
    })
  );
};

const quoteCmdValue = (value: string): string => value.replace(/"/g, '');

const quoteCmdArg = (value: string): string => `"${value.replace(/"/g, '\\"')}"`;

const quoteShell = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

export const buildCliAssistantCloudEnv = (request: CliAssistantLaunchRequest): Record<string, string> => ({
  AION_CLOUD_API_BASE: request.apiBaseUrl,
  LINGAI_CLOUD_API_BASE: request.apiBaseUrl,
  LINGAI_CLOUD_MODEL_LIST_URL: `${request.apiBaseUrl}/api/models/list`,
  LINGAI_CLOUD_PROXY_BASE_URL: request.proxyBaseUrl,
  LINGAI_MODEL: request.modelId,
  OPENAI_API_KEY: request.token,
  OPENAI_BASE_URL: request.proxyBaseUrl,
  OPENAI_MODEL: request.modelId,
  ANTHROPIC_API_KEY: request.token,
  ANTHROPIC_AUTH_TOKEN: request.token,
  ANTHROPIC_BASE_URL: `${request.apiBaseUrl}/api/proxy/anthropic`,
  ANTHROPIC_MODEL: request.modelId,
  GEMINI_API_KEY: request.token,
  GOOGLE_API_KEY: request.token,
  GEMINI_MODEL: request.modelId,
});

const buildWindowsScript = (lines: string[], workspace?: string): string => {
  const body = [
    '@echo off',
    'chcp 65001 >nul',
    'echo LingAI CLI Assistant',
    workspace ? `cd /d ${quoteCmdArg(workspace)}` : undefined,
    ...lines,
    'echo.',
    'echo CLI exited. Press any key to close this window.',
    'pause >nul',
    'del "%~f0" >nul 2>nul',
  ].filter((line): line is string => Boolean(line));
  return `${body.join('\r\n')}\r\n`;
};

const buildShellScript = (lines: string[], workspace?: string): string => {
  const body = [
    '#!/usr/bin/env bash',
    'set -e',
    'echo "LingAI CLI Assistant"',
    workspace ? `cd ${quoteShell(workspace)}` : undefined,
    ...lines,
    'echo',
    'read -n 1 -s -r -p "CLI exited. Press any key to close this window." || true',
    'rm -f "$0"',
  ].filter((line): line is string => Boolean(line));
  return `${body.join('\n')}\n`;
};

const writeTerminalScript = async (title: string, lines: string[], workspace?: string): Promise<string> => {
  const scriptDir = await mkdtemp(path.join(tmpdir(), 'lingai-cli-'));
  const extension = process.platform === 'win32' ? '.cmd' : process.platform === 'darwin' ? '.command' : '.sh';
  const scriptPath = path.join(scriptDir, `${title.replace(/[^a-z0-9_-]/gi, '-')}${extension}`);
  const content = process.platform === 'win32' ? buildWindowsScript(lines, workspace) : buildShellScript(lines, workspace);
  await writeFile(scriptPath, content, { encoding: 'utf8' });
  if (process.platform !== 'win32') {
    await chmod(scriptPath, 0o700);
  }
  return scriptPath;
};

const openTerminalScript = async (title: string, scriptPath: string): Promise<void> => {
  if (process.platform === 'win32') {
    spawn('cmd.exe', ['/d', '/c', 'start', `LingAI ${title}`, 'cmd.exe', '/k', scriptPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    }).unref();
    return;
  }

  if (process.platform === 'darwin') {
    spawn('open', ['-a', 'Terminal', scriptPath], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    return;
  }

  const terminals: Array<{ command: string; args: string[] }> = [
    { command: 'x-terminal-emulator', args: ['-e', 'bash', scriptPath] },
    { command: 'gnome-terminal', args: ['--', 'bash', scriptPath] },
    { command: 'konsole', args: ['-e', 'bash', scriptPath] },
    { command: 'xfce4-terminal', args: ['-e', `bash ${quoteShell(scriptPath)}`] },
    { command: 'xterm', args: ['-e', 'bash', scriptPath] },
  ];

  for (const terminal of terminals) {
    if (!(await findCommandPath(terminal.command))) {
      continue;
    }
    spawn(terminal.command, terminal.args, {
      detached: true,
      stdio: 'ignore',
    }).unref();
    return;
  }

  throw new Error('No supported terminal application was found.');
};

export const installCliAssistant = async (id: CliAssistantId): Promise<CliAssistantCommandResult> => {
  const definition = getDefinition(id);
  const scriptPath = await writeTerminalScript(definition.id, [`npm install -g ${definition.npmPackage}`]);
  await openTerminalScript(definition.name, scriptPath);
  return { success: true };
};

export const launchCliAssistant = async (request: CliAssistantLaunchRequest): Promise<CliAssistantCommandResult> => {
  const definition = getDefinition(request.id);
  if (!request.token) {
    return { success: false, message: 'Missing cloud token.' };
  }
  if (!request.modelId) {
    return { success: false, message: 'Missing cloud model.' };
  }

  const env = buildCliAssistantCloudEnv(request);
  const commandParts = [definition.command, ...definition.launchModelArg(request.modelId)];
  const scriptLines =
    process.platform === 'win32'
      ? [
          ...Object.entries(env).map(([key, value]) => `set "${key}=${quoteCmdValue(value)}"`),
          commandParts.map(quoteCmdArg).join(' '),
        ]
      : [...Object.entries(env).map(([key, value]) => `export ${key}=${quoteShell(value)}`), commandParts.map(quoteShell).join(' ')];

  const scriptPath = await writeTerminalScript(definition.id, scriptLines, request.workspace);
  await openTerminalScript(definition.name, scriptPath);
  return { success: true };
};

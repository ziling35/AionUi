import { ipcBridge } from '@/common';
import { assistantRuntimeKey, type Assistant, type CreateAssistantRequest } from '@/common/types/agent/assistantTypes';
import type { AgentEnvEntry, AgentMetadata, ManagedAgent } from '@/renderer/utils/model/agentTypes';
import { listCloudModels, type CloudModel } from './cloud';
import { getCloudApiBase, getCloudProxyBase } from './config';

export const CLOUD_CODEX_ASSISTANT_ID = 'lingai-codex-cloud';

const CLOUD_CODEX_AGENT_NAME = 'LingAI Codex \u4e91\u7aef\u7248';
const CLOUD_CODEX_AGENT_NAME_ZH_TW = 'LingAI Codex \u96f2\u7aef\u7248';
const CLOUD_CODEX_AGENT_MARKER = 'LINGAI_CLOUD_CODEX_AGENT';
const CLOUD_CODEX_AVATAR = '\u2601\ufe0f';
const GUEST_TOKEN = 'guest-not-authenticated';

type SyncCloudCodexOptions = {
  preferredModel?: string | null;
};

type SyncCloudCodexResult =
  | { status: 'synced'; agentId: string; assistantId: string; modelIds: string[] }
  | { status: 'skipped'; reason: 'codex_agent_missing' | 'codex_command_missing' };

type AgentCommandSource = Pick<ManagedAgent, 'command' | 'args' | 'env' | 'icon' | 'avatar' | 'behavior_policy'>;

function envEntriesToRecord(entries: AgentEnvEntry[] | undefined): Record<string, string> {
  const record: Record<string, string> = {};
  for (const entry of entries ?? []) {
    if (entry.name) record[entry.name] = entry.value;
  }
  return record;
}

function envRecordToEntries(record: Record<string, string>): AgentEnvEntry[] {
  return Object.entries(record).map(([name, value]) => ({ name, value }));
}

function isCloudCodexAgent(agent: ManagedAgent): boolean {
  if (agent.name === CLOUD_CODEX_AGENT_NAME || agent.name === 'LingAI Codex Cloud') return true;
  return envEntriesToRecord(agent.env)[CLOUD_CODEX_AGENT_MARKER] === '1';
}

export function isCloudCodexAssistantId(assistantId: string | null | undefined): boolean {
  return assistantId === CLOUD_CODEX_ASSISTANT_ID || assistantId === `builtin-${CLOUD_CODEX_ASSISTANT_ID}`;
}

export function isCloudCodexAssistant(assistant: Pick<Assistant, 'id' | 'name' | 'name_i18n'> | null | undefined): boolean {
  if (!assistant) return false;
  if (isCloudCodexAssistantId(assistant.id)) return true;
  const names = [
    assistant.name,
    assistant.name_i18n?.['en-US'],
    assistant.name_i18n?.['zh-CN'],
    assistant.name_i18n?.['zh-TW'],
  ];
  return names.some(
    (name) => name === CLOUD_CODEX_AGENT_NAME || name === CLOUD_CODEX_AGENT_NAME_ZH_TW || name === 'LingAI Codex Cloud'
  );
}

export function normalizeCloudCodexAssistant<T extends Assistant>(assistant: T): T {
  if (!isCloudCodexAssistant(assistant)) {
    return assistant;
  }

  return {
    ...assistant,
    source: 'builtin',
    deletable: false,
    name: CLOUD_CODEX_AGENT_NAME,
    name_i18n: {
      ...assistant.name_i18n,
      'en-US': 'LingAI Codex Cloud',
      'zh-CN': CLOUD_CODEX_AGENT_NAME,
      'zh-TW': CLOUD_CODEX_AGENT_NAME_ZH_TW,
    },
  };
}

export function normalizeCloudCodexAssistants<T extends Assistant>(assistants: T[]): T[] {
  return assistants.filter((assistant) => !isCloudCodexAssistant(assistant));
}

export function pickCodexBaseAgent(agents: ManagedAgent[]): ManagedAgent | undefined {
  return agents.find((agent) => {
    if (agent.agent_source === 'custom' && isCloudCodexAgent(agent)) return false;
    const backend = (agent.backend || '').toLowerCase();
    const name = (agent.name || '').toLowerCase();
    return backend === 'codex' || name.includes('codex');
  });
}

function pickCodexAssistant(assistants: Assistant[]): Assistant | undefined {
  return assistants.find((assistant) => {
    if (isCloudCodexAssistant(assistant)) return false;
    const runtimeKey = assistantRuntimeKey(assistant).toLowerCase();
    const name = assistant.name.toLowerCase();
    return runtimeKey === 'codex' || name.includes('codex');
  });
}

function resolveCodexBaseAgent(agents: ManagedAgent[], assistants: Assistant[]): ManagedAgent | undefined {
  const codexAssistant = pickCodexAssistant(assistants);
  if (codexAssistant?.agent_id) {
    const boundAgent = agents.find((agent) => agent.id === codexAssistant.agent_id);
    if (boundAgent) return boundAgent;
  }

  return pickCodexBaseAgent(agents);
}

function pickPreferredModel(models: CloudModel[], preferredModel?: string | null): string {
  if (preferredModel && models.some((model) => model.modelId === preferredModel)) {
    return preferredModel;
  }

  return models[0]?.modelId ?? '';
}

export function buildCloudCodexEnv(token: string | null | undefined, modelId: string): Record<string, string> {
  const apiBaseUrl = getCloudApiBase();
  const proxyBaseUrl = getCloudProxyBase();
  const apiToken = token || GUEST_TOKEN;

  return {
    [CLOUD_CODEX_AGENT_MARKER]: '1',
    AION_CLOUD_API_BASE: apiBaseUrl,
    LINGAI_CLOUD_API_BASE: apiBaseUrl,
    LINGAI_CLOUD_MODEL_LIST_URL: `${apiBaseUrl}/api/models/list`,
    LINGAI_CLOUD_PROXY_BASE_URL: proxyBaseUrl,
    LINGAI_MODEL: modelId,
    OPENAI_API_KEY: apiToken,
    OPENAI_BASE_URL: proxyBaseUrl,
    OPENAI_MODEL: modelId,
  };
}

function buildCloudCodexAgentEnv(
  baseAgent: AgentCommandSource,
  token: string | null | undefined,
  modelId: string
): AgentEnvEntry[] {
  return envRecordToEntries({
    ...envEntriesToRecord(baseAgent.env),
    ...buildCloudCodexEnv(token, modelId),
  });
}

function resolveAgentCommand(agent: ManagedAgent): string {
  return agent.command || '';
}

function buildAssistantPayload(agentId: string, models: string[], id?: string): CreateAssistantRequest {
  return {
    ...(id ? { id } : {}),
    name: CLOUD_CODEX_AGENT_NAME,
    name_i18n: {
      'en-US': 'LingAI Codex Cloud',
      'zh-CN': CLOUD_CODEX_AGENT_NAME,
      'zh-TW': CLOUD_CODEX_AGENT_NAME_ZH_TW,
    },
    description:
      'Routes Codex requests through LingAI Cloud models and quota billing. Local Codex runtime is still required.',
    description_i18n: {
      'en-US': 'Routes Codex requests through LingAI Cloud models and quota billing. Local Codex runtime is still required.',
      'zh-CN':
        '\u901a\u8fc7 LingAI \u4e91\u7aef\u6a21\u578b\u548c\u989d\u5ea6\u8ba1\u8d39\u8fd0\u884c Codex\uff1b\u4ecd\u9700\u8981\u672c\u673a Codex \u8fd0\u884c\u73af\u5883\u3002',
      'zh-TW':
        '\u900f\u904e LingAI \u96f2\u7aef\u6a21\u578b\u548c\u984d\u5ea6\u8a08\u8cbb\u57f7\u884c Codex\uff1b\u4ecd\u9700\u8981\u672c\u6a5f Codex \u57f7\u884c\u74b0\u5883\u3002',
    },
    avatar: CLOUD_CODEX_AVATAR,
    agent_id: agentId,
    models,
    prompts: [],
    prompts_i18n: {},
  };
}

async function upsertCloudCodexAgent(
  agents: ManagedAgent[],
  baseAgent: ManagedAgent,
  token: string | null | undefined,
  modelId: string
): Promise<AgentMetadata> {
  const existing = agents.find(isCloudCodexAgent);
  const payload = {
    name: CLOUD_CODEX_AGENT_NAME,
    icon: baseAgent.icon || baseAgent.avatar || CLOUD_CODEX_AVATAR,
    command: baseAgent.command || '',
    args: baseAgent.args,
    env: buildCloudCodexAgentEnv(baseAgent, token, modelId),
    advanced: {
      description:
        'LingAI cloud-routed Codex agent. The local Codex ACP adapter starts normally, but OpenAI-compatible traffic is forced through LingAI Cloud.',
      behavior_policy: baseAgent.behavior_policy,
    },
  };

  if (existing) {
    return ipcBridge.acpConversation.updateCustomAgent.invoke({ id: existing.id, ...payload });
  }

  return ipcBridge.acpConversation.createCustomAgent.invoke(payload);
}

async function upsertCloudCodexAssistant(agentId: string, modelIds: string[]): Promise<string> {
  const assistants = await ipcBridge.assistants.list.invoke().catch((): Assistant[] => []);
  const existing = assistants.find(isCloudCodexAssistant);
  if (existing) {
    const payload = buildAssistantPayload(agentId, modelIds, existing.id);
    await ipcBridge.assistants.update.invoke({ id: existing.id, ...payload });
    return existing.id;
  }

  const created = await ipcBridge.assistants.create.invoke(buildAssistantPayload(agentId, modelIds));
  return created.id;
}

export async function syncCloudCodexAssistant(
  token?: string | null,
  options: SyncCloudCodexOptions = {}
): Promise<SyncCloudCodexResult> {
  const [agents, models, assistants] = await Promise.all([
    ipcBridge.acpConversation.getManagedAgents.invoke(),
    listCloudModels(),
    ipcBridge.assistants.list.invoke().catch((): Assistant[] => []),
  ]);
  const baseAgent = resolveCodexBaseAgent(agents, assistants);
  if (!baseAgent) {
    return { status: 'skipped', reason: 'codex_agent_missing' };
  }

  const activeModels = models.filter((model) => model.isActive && model.type !== 'embedding');
  const modelIds = activeModels.map((model) => model.modelId);
  const selectedModel = pickPreferredModel(activeModels, options.preferredModel);
  const command = resolveAgentCommand(baseAgent);
  if (!command) {
    const assistantId = await upsertCloudCodexAssistant(baseAgent.id, modelIds);
    return { status: 'synced', agentId: baseAgent.id, assistantId, modelIds };
  }

  const cloudAgent = await upsertCloudCodexAgent(agents, { ...baseAgent, command }, token, selectedModel);
  await ipcBridge.acpConversation.refreshCustomAgents.invoke();
  const assistantId = await upsertCloudCodexAssistant(cloudAgent.id, modelIds);

  return { status: 'synced', agentId: cloudAgent.id, assistantId, modelIds };
}

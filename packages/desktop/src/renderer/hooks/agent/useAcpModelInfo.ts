/**
 * @license
 * Copyright 2025 LingAI (lingai.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import type { IProvider } from '@/common/config/storage';
import type { AcpConfigOptionDto, AcpModelInfo } from '@/common/types/platform/acpTypes';
import { type AcpConfigSetStatus, type AcpDerivedOption, useAcpConfigOptions } from './useAcpConfigOptions';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CLOUD_PROVIDER_ID } from '@/renderer/api/config';
import { decodeCloudRoutingModelId } from '@/renderer/api/cloud';
import { useModelProviderList } from './useModelProviderList';

type UseAcpModelInfoArgs = {
  conversation_id: string;
  backend?: string;
  initialModelId?: string;
  prepareRuntime?: () => Promise<void>;
  enabled?: boolean;
  onSelectModelSuccess?: (model_id: string) => void;
  onSelectModelFailed?: (model_id: string, error: unknown) => void;
};

export type UseAcpModelInfoResult = {
  model_info: AcpModelInfo | null;
  canSwitch: boolean;
  isSetting: boolean;
  selectModel: (model_id: string) => void;
  thoughtLevel: AcpDerivedOption | null;
  setStatus: AcpConfigSetStatus;
  setConfigOption: (optionId: string, value: string) => Promise<AcpConfigOptionDto[]>;
};

const getModelOptionKey = (model: AcpModelInfo['available_models'][number]): string => model.optionKey || model.id;
export const LINGCODEX_BACKEND = 'lingcodex';

const isImageModel = (modelId: string): boolean => modelId.toLowerCase().includes('image');

const cloudModelMatches = (modelId: string, candidate?: string | null): boolean => {
  if (!candidate) return false;
  const rawModelId = decodeCloudRoutingModelId(modelId) || modelId;
  const rawCandidate = decodeCloudRoutingModelId(candidate) || candidate;
  return modelId === candidate || rawModelId === candidate || rawCandidate === modelId || rawModelId === rawCandidate;
};

export type LingCodexCloudModelInfoInput = {
  providers: IProvider[];
  getAvailableModels: (provider: IProvider) => string[];
  formatModelLabel: (provider: Pick<IProvider, 'model_labels'> | undefined, modelName?: string) => string;
  initialModelId?: string | null;
  selectedModelOptionKey?: string | null;
};

export function buildLingcodexCloudModelInfo({
  providers,
  getAvailableModels,
  formatModelLabel,
  initialModelId,
  selectedModelOptionKey,
}: LingCodexCloudModelInfoInput): AcpModelInfo | null {
  const availableProviders = providers.filter((provider) => provider.enabled !== false);
  const availableModels: AcpModelInfo['available_models'] = availableProviders.flatMap((provider, providerIndex) =>
    getAvailableModels(provider)
      .filter((modelId) => !isImageModel(modelId))
      .map((modelId, modelIndex) => ({
        id: modelId,
        optionKey: `${provider.id === CLOUD_PROVIDER_ID ? 'cloud' : 'provider'}:${providerIndex}:${modelIndex}:${modelId}`,
        label: formatModelLabel(provider, modelId),
        source: provider.id === CLOUD_PROVIDER_ID ? ('cloud' as const) : ('runtime' as const),
        providerId: provider.id,
        providerName: provider.name,
      }))
  );
  if (availableModels.length === 0) return null;
  const currentModelId = selectedModelOptionKey
    ? availableModels.find((item) => getModelOptionKey(item) === selectedModelOptionKey)?.id
    : undefined;
  const selectedModel =
    (currentModelId && availableModels.find((item) => item.id === currentModelId)) ||
    (initialModelId && availableModels.find((item) => cloudModelMatches(item.id, initialModelId))) ||
    availableModels[0];
  return {
    current_model_id: selectedModel.id,
    current_model_option_key: getModelOptionKey(selectedModel),
    current_model_label: selectedModel.label,
    available_models: availableModels,
  };
}

function sameModelInfo(a: AcpModelInfo | null, b: AcpModelInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.current_model_id === b.current_model_id &&
    a.current_model_option_key === b.current_model_option_key &&
    a.current_model_label === b.current_model_label &&
    a.available_models.length === b.available_models.length &&
    a.available_models.every((item, index) => {
      const other = b.available_models[index];
      return (
        other?.id === item.id &&
        other.optionKey === item.optionKey &&
        other.source === item.source &&
        other.providerId === item.providerId &&
        other.providerName === item.providerName &&
        other.label === item.label &&
        other.description === item.description
      );
    })
  );
}

function normalizeInitialModel(info: AcpModelInfo, initialModelId?: string): AcpModelInfo {
  if (!initialModelId || info.current_model_id) return info;
  const match = info.available_models.find((model) => model.id === initialModelId);
  if (!match) return info;
  return {
    ...info,
    current_model_id: initialModelId,
    current_model_label: match.label || initialModelId,
  };
}

export const useAcpModelInfo = ({
  conversation_id,
  backend,
  initialModelId,
  prepareRuntime,
  enabled = true,
  onSelectModelSuccess,
  onSelectModelFailed,
}: UseAcpModelInfoArgs): UseAcpModelInfoResult => {
  const runtimeConfigEnabled = enabled && backend !== LINGCODEX_BACKEND;
  const { model, thoughtLevel, setStatus, setConfigOption } = useAcpConfigOptions({
    conversation_id,
    prepareRuntime,
    enabled: runtimeConfigEnabled,
  });
  const { providers, getAvailableModels, formatModelLabel } = useModelProviderList();
  const [legacyModelInfo, setLegacyModelInfo] = useState<AcpModelInfo | null>(null);
  const [selectedModelOptionKey, setSelectedModelOptionKey] = useState<string | null>(null);

  const lingcodexModelInfo = useMemo<AcpModelInfo | null>(() => {
    if (backend !== LINGCODEX_BACKEND) return null;
    return buildLingcodexCloudModelInfo({
      providers,
      getAvailableModels,
      formatModelLabel,
      initialModelId,
      selectedModelOptionKey,
    });
  }, [backend, formatModelLabel, getAvailableModels, initialModelId, providers, selectedModelOptionKey]);

  const configModelInfo = useMemo<AcpModelInfo | null>(() => {
    if (!model) return null;
    const currentModelId = model.currentValue || initialModelId || null;
    const runtimeModels: AcpModelInfo['available_models'] = model.options.map((item, index) => ({
      id: item.value,
      optionKey: `runtime:${index}:${item.value}`,
      label: item.label,
      description: item.description ?? undefined,
      source: 'runtime',
    }));
    const availableModels = runtimeModels;
    const selectedByState = selectedModelOptionKey
      ? availableModels.find((item) => getModelOptionKey(item) === selectedModelOptionKey && item.id === currentModelId)
      : undefined;
    const selectedByRuntime = runtimeModels.find((item) => item.id === currentModelId);
    const selectedModel = selectedByState || selectedByRuntime;
    return {
      current_model_id: currentModelId,
      current_model_option_key: selectedModel ? getModelOptionKey(selectedModel) : null,
      current_model_label:
        selectedModel?.label ||
        model.options.find((item) => item.value === currentModelId)?.label ||
        currentModelId ||
        null,
      available_models: availableModels,
    };
  }, [initialModelId, model, selectedModelOptionKey]);

  useEffect(() => {
    if (!enabled) {
      setLegacyModelInfo(null);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const handler = (message: IResponseMessage) => {
      if (message.conversation_id !== conversation_id) return;
      if (message.type === 'acp_model_info' && message.data) {
        const incoming = normalizeInitialModel(message.data as AcpModelInfo, initialModelId);
        setLegacyModelInfo((previous) => (sameModelInfo(previous, incoming) ? previous : incoming));
      } else if (message.type === 'codex_model_info' && message.data) {
        const data = message.data as { model?: string };
        if (!data.model) return;
        const incoming: AcpModelInfo = {
          current_model_id: data.model,
          current_model_label: data.model,
          available_models: [],
        };
        setLegacyModelInfo((previous) => (sameModelInfo(previous, incoming) ? previous : incoming));
      }
    };
    return ipcBridge.acpConversation.responseStream.on(handler);
  }, [conversation_id, enabled, initialModelId]);

  const model_info = lingcodexModelInfo ?? configModelInfo ?? legacyModelInfo;

  const selectModel = useCallback(
    (model_id: string) => {
      if (!enabled) return;
      const sourceModelInfo = lingcodexModelInfo ?? configModelInfo;
      const selectedModel = sourceModelInfo?.available_models.find(
        (item) => getModelOptionKey(item) === model_id || item.id === model_id
      );
      const nextModelId = selectedModel?.id || model_id;
      const nextModelOptionKey = selectedModel ? getModelOptionKey(selectedModel) : model_id;
      if (backend === LINGCODEX_BACKEND && selectedModel?.source === 'cloud') {
        void ipcBridge.acpConversation.setConfigOption
          .invoke({
            conversation_id,
            option_id: 'model',
            value: nextModelId,
          })
          .then((response) => {
            if (response.confirmation !== 'observed') throw new Error(response.confirmation);
            setSelectedModelOptionKey(nextModelOptionKey);
            onSelectModelSuccess?.(nextModelId);
          })
          .catch((error) => {
            onSelectModelFailed?.(nextModelId, error);
          });
        return;
      }
      if (!model) return;
      void setConfigOption(model.id, nextModelId)
        .then(async () => {
          setSelectedModelOptionKey(nextModelOptionKey);
          onSelectModelSuccess?.(nextModelId);
        })
        .catch((error) => {
          onSelectModelFailed?.(nextModelId, error);
        });
    },
    [
      backend,
      configModelInfo,
      conversation_id,
      enabled,
      lingcodexModelInfo,
      model,
      onSelectModelFailed,
      onSelectModelSuccess,
      setConfigOption,
    ]
  );

  return {
    model_info,
    canSwitch: Boolean(
      (lingcodexModelInfo && lingcodexModelInfo.available_models.length > 0) ||
      (configModelInfo && configModelInfo.available_models.length > 0)
    ),
    isSetting: setStatus.state === 'setting' && setStatus.optionId === model?.id,
    selectModel,
    thoughtLevel,
    setStatus,
    setConfigOption,
  };
};

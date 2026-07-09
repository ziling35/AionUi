/**
 * @license
 * Copyright 2025 LingAI (lingai.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { useGoogleAuthModels } from '@/renderer/hooks/agent/useGoogleAuthModels';
import { useModelProviderList } from '@/renderer/hooks/agent/useModelProviderList';
import { hasAvailableModels } from '../utils/modelUtils';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Build a unique key for a provider/model pair.
 */
const buildModelKey = (providerId?: string, modelName?: string) => {
  if (!providerId || !modelName) return null;
  return `${providerId}:${modelName}`;
};

/**
 * Check if a model key still exists in the provider list.
 */
const isModelKeyAvailable = (key: string | null, providers?: IProvider[]) => {
  if (!key || !providers || providers.length === 0) return false;
  return providers.some((provider) => {
    if (!provider.id || !provider.models?.length) return false;
    return provider.models.some((modelName) => buildModelKey(provider.id, modelName) === key);
  });
};

/** Provider-based agent keys that share the model list UI */
type ProviderAgentKey = 'aionrs';

export type GuidModelSelectionResult = {
  modelList: IProvider[];
  isGoogleAuth: boolean;
  formatGeminiModelLabel: (provider: Pick<IProvider, 'model_labels'> | undefined, modelName?: string) => string;
  current_model: TProviderWithModel | undefined;
  setCurrentModel: (model_info: TProviderWithModel, options?: { persistPreference?: boolean }) => Promise<void>;
  resetCurrentModel: (options?: { persistPreference?: boolean }) => Promise<void>;
};

/**
 * Hook that manages the provider-backed model selection state for the Guid page.
 * Assistant-driven defaults are applied by the caller; this hook only owns the
 * transient in-page selection.
 * @param agentKey - current provider-based agent (currently only 'aionrs')
 */
export const useGuidModelSelection = (agentKey: ProviderAgentKey = 'aionrs'): GuidModelSelectionResult => {
  const { isGoogleAuth } = useGoogleAuthModels();
  const { providers, formatModelLabel } = useModelProviderList();

  const modelList = useMemo(() => {
    return providers.filter(hasAvailableModels);
  }, [providers]);

  const [current_model, _setCurrentModel] = useState<TProviderWithModel>();
  const selectedModelKeyRef = useRef<string | null>(null);

  const setCurrentModel = useCallback(
    async (model_info: TProviderWithModel, _options?: { persistPreference?: boolean }) => {
      selectedModelKeyRef.current = buildModelKey(model_info.id, model_info.use_model);
      _setCurrentModel(model_info);
    },
    []
  );

  const resetCurrentModel = useCallback(
    async (options?: { persistPreference?: boolean }) => {
      if (!modelList || modelList.length === 0) {
        return;
      }

      selectedModelKeyRef.current = null;

      const defaultModel = modelList[0];
      const resolvedUseModel = defaultModel?.models[0] ?? '';

      if (!defaultModel || !resolvedUseModel) return;

      await setCurrentModel(
        {
          ...defaultModel,
          use_model: resolvedUseModel,
        },
        options
      );
    },
    [modelList, setCurrentModel]
  );

  // Set default model when modelList or agent changes
  useEffect(() => {
    const setDefaultModel = async () => {
      if (!modelList || modelList.length === 0) {
        return;
      }
      const currentKey = selectedModelKeyRef.current || buildModelKey(current_model?.id, current_model?.use_model);
      if (isModelKeyAvailable(currentKey, modelList)) {
        if (!selectedModelKeyRef.current && currentKey) {
          selectedModelKeyRef.current = currentKey;
        }
        return;
      }
      await resetCurrentModel();
    };

    setDefaultModel().catch((error) => {
      console.error('Failed to set default model:', error);
    });
  }, [agentKey, current_model?.id, current_model?.use_model, modelList, resetCurrentModel]);
  return {
    modelList,
    isGoogleAuth,
    formatGeminiModelLabel: formatModelLabel,
    current_model,
    setCurrentModel,
    resetCurrentModel,
  };
};

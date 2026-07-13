/**
 * @license
 * Copyright 2025 LingAI (lingai.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import styles from '../index.module.css';
import { assistantRuntimeKey, type Assistant } from '@/common/types/agent/assistantTypes';
import { Down, Robot, Search } from '@icon-park/react';
import { Button, Dropdown, Input } from '@arco-design/web-react';
import React, { useMemo, useState } from 'react';
import { resolveAssistantAvatar } from '@/renderer/utils/model/assistantAvatar';
import { selectableAssistants } from '@/renderer/utils/model/assistantSelection';
import { useTranslation } from 'react-i18next';
import appLogo from '@renderer/assets/logos/brand/app.png';

type AssistantSelectionAreaProps = {
  selectedAssistantId?: string | null;
  assistants: Assistant[];
  localeKey: string;
  onSelectAssistant: (assistantId: string) => void;
};

const LINGCODEX_BACKEND = 'lingcodex';
const CODEX_BACKEND = 'codex';

const isAssistantBackend = (assistant: Assistant, backend: string): boolean =>
  assistantRuntimeKey(assistant) === backend;

const preferLingCodexOverCodex = (assistants: Assistant[]): Assistant[] => {
  const lingCodex = assistants.find((assistant) => isAssistantBackend(assistant, LINGCODEX_BACKEND));
  const codexIndex = assistants.findIndex((assistant) => isAssistantBackend(assistant, CODEX_BACKEND));

  if (!lingCodex || codexIndex < 0) {
    return assistants;
  }

  const lingCodexIndex = assistants.findIndex((assistant) => assistant.id === lingCodex.id);
  if (lingCodexIndex < 0 || lingCodexIndex <= codexIndex) {
    return assistants;
  }

  const codex = assistants[codexIndex];
  const reordered = assistants.filter((assistant) => assistant.id !== lingCodex.id && assistant.id !== codex.id);
  reordered.splice(codexIndex, 0, lingCodex);
  reordered.push(codex);
  return reordered;
};

const AssistantSelectionArea: React.FC<AssistantSelectionAreaProps> = ({
  selectedAssistantId,
  assistants,
  localeKey,
  onSelectAssistant,
}) => {
  const { t } = useTranslation();
  const [moreVisible, setMoreVisible] = useState(false);
  const [search, setSearch] = useState('');
  const selectedId = selectedAssistantId || undefined;
  const enabledAssistants = useMemo(() => preferLingCodexOverCodex(selectableAssistants(assistants)), [assistants]);
  const visibleAssistants = useMemo(() => {
    const hasLingCodex = enabledAssistants.some((assistant) => isAssistantBackend(assistant, LINGCODEX_BACKEND));
    const primaryAssistants = enabledAssistants.filter(
      (assistant) => !(hasLingCodex && isAssistantBackend(assistant, CODEX_BACKEND))
    );
    const selectedAssistant = selectedId
      ? enabledAssistants.find((assistant) => assistant.id === selectedId)
      : undefined;
    const shouldKeepSelectedInOverflow = selectedAssistant
      ? isAssistantBackend(selectedAssistant, CODEX_BACKEND) && hasLingCodex
      : false;

    if (primaryAssistants.length <= 4 || !selectedId) {
      return primaryAssistants.slice(0, 4);
    }

    if (shouldKeepSelectedInOverflow) {
      return primaryAssistants.slice(0, 4);
    }

    const selectedIndex = primaryAssistants.findIndex((assistant) => assistant.id === selectedId);
    if (selectedIndex < 0 || selectedIndex < 4) {
      return primaryAssistants.slice(0, 4);
    }

    return [...primaryAssistants.slice(0, 3), primaryAssistants[selectedIndex]];
  }, [enabledAssistants, selectedId]);
  const hasOverflow = enabledAssistants.length > visibleAssistants.length;
  const overflowAssistants = useMemo(() => {
    const visibleIds = new Set(visibleAssistants.map((assistant) => assistant.id));
    return enabledAssistants.filter((assistant) => !visibleIds.has(assistant.id));
  }, [enabledAssistants, visibleAssistants]);
  const filteredOverflowAssistants = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return overflowAssistants;
    return overflowAssistants.filter((assistant) => {
      const label = assistant.name_i18n?.[localeKey] || assistant.name;
      return label.toLowerCase().includes(query);
    });
  }, [localeKey, overflowAssistants, search]);

  if (enabledAssistants.length === 0) return null;

  const renderAssistantPill = (assistant: Assistant, testId: string) => {
    const isAiCliAssistant = assistant.name === 'Aion CLI' || assistant.name === 'AI CLI';
    const isLingAiButler = assistant.id === 'aionui-assistant';
    const avatar =
      isAiCliAssistant || isLingAiButler
        ? { kind: 'image' as const, value: appLogo }
        : resolveAssistantAvatar(assistant.avatar);
    const isSelected = selectedId === assistant.id;
    const rawLabel = assistant.name_i18n?.[localeKey] || assistant.name;
    const label = isAiCliAssistant ? 'AI CLI' : isLingAiButler ? 'LingAI \u7ba1\u5bb6' : rawLabel;

    return (
      <Button
        key={assistant.id}
        data-testid={testId}
        data-assistant-id={assistant.id}
        data-assistant-backend={assistantRuntimeKey(assistant)}
        data-assistant-selected={isSelected ? 'true' : 'false'}
        type='text'
        className={`!inline-flex !min-w-0 !h-auto !items-center !gap-6px !rounded-999px !border-none !px-12px !py-8px !text-13px transition-all ${
          isSelected
            ? 'font-600 text-t-primary shadow-sm'
            : `text-t-secondary opacity-75 hover:opacity-100 ${styles.assistantSelectorInactive}`
        }`}
        style={isSelected ? { background: 'var(--bg-base, #fff)' } : { background: 'transparent' }}
        onClick={() => {
          onSelectAssistant(assistant.id);
          setMoreVisible(false);
        }}
      >
        <span className='inline-flex h-20px w-20px items-center justify-center overflow-hidden rounded-999px bg-fill-2'>
          {avatar.kind === 'image' ? (
            <img src={avatar.value} alt='' className='h-full w-full object-contain' />
          ) : avatar.kind === 'emoji' ? (
            <span className={styles.assistantCardEmoji}>{avatar.value}</span>
          ) : (
            <Robot theme='outline' size={14} />
          )}
        </span>
        <span className='max-w-180px truncate whitespace-nowrap'>{label}</span>
      </Button>
    );
  };

  const overflowDroplist = (
    <div
      className='min-w-240px rounded-12px border border-border-2 p-8px shadow-lg'
      style={{ background: 'var(--bg-base, #fff)' }}
    >
      <div className='mb-8px'>
        <Input
          size='small'
          value={search}
          onChange={setSearch}
          prefix={<Search theme='outline' size={14} />}
          placeholder={t('team.create.searchPlaceholder', { defaultValue: 'Search assistants...' })}
        />
      </div>
      <div className='flex max-h-260px flex-col gap-4px overflow-y-auto'>
        {filteredOverflowAssistants.map((assistant) => (
          <div key={assistant.id}>{renderAssistantPill(assistant, `assistant-overflow-${assistant.id}`)}</div>
        ))}
      </div>
    </div>
  );

  return (
    <div className='mt-18px mb-16px w-full'>
      <div className='flex w-full justify-center'>
        <div
          className='inline-flex max-w-full items-center rounded-999px px-6px py-6px'
          style={{ background: 'var(--color-guid-agent-bar, var(--aou-2))' }}
        >
          <div className='flex min-w-0 max-w-full items-center gap-6px'>
            {visibleAssistants.map((assistant) => renderAssistantPill(assistant, `preset-pill-${assistant.id}`))}
            {hasOverflow ? (
              <Dropdown
                trigger='click'
                position='bl'
                droplist={overflowDroplist}
                popupVisible={moreVisible}
                onVisibleChange={setMoreVisible}
              >
                <Button
                  data-testid='assistant-more-btn'
                  type='text'
                  className={`!ml-6px !inline-flex !h-34px !shrink-0 !items-center !gap-4px !rounded-999px !border-none !px-12px !py-8px !text-13px !text-t-secondary opacity-75 transition-opacity hover:opacity-100 ${styles.assistantSelectorInactive}`}
                >
                  <span>{t('common.more', { defaultValue: 'More' })}</span>
                  <Down theme='outline' size={14} />
                </Button>
              </Dropdown>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AssistantSelectionArea;

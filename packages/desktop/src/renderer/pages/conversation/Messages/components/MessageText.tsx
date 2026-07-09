/**
 * @license
 * Copyright 2025 LingAI (lingai.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageText } from '@/common/chat/chatLib';
import { ipcBridge } from '@/common';
import type { ConversationTimeTravelPreview } from '@/common/adapter/ipcBridge';
import { LINGAI_FILES_MARKER } from '@/common/config/constants';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { useLocalFilePreview } from '@/renderer/pages/conversation/Preview/hooks/useLocalFilePreview';
import { iconColors } from '@/renderer/styles/colors';
import { emitter } from '@/renderer/utils/emitter';
import { Alert, Button, Message, Modal, Tooltip } from '@arco-design/web-react';
import { Copy, History, ReplayMusic } from '@icon-park/react';
import classNames from 'classnames';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { copyText } from '@/renderer/utils/ui/clipboard';
import CollapsibleContent from '@renderer/components/chat/CollapsibleContent';
import FilePreview from '@renderer/components/media/FilePreview';
import HorizontalFileList from '@renderer/components/media/HorizontalFileList';
import MarkdownView from '@renderer/components/Markdown';
import { stripThinkTags, hasThinkTags } from '@renderer/utils/chat/thinkTagFilter';
import { stripSkillSuggest, hasSkillSuggest } from '@renderer/utils/chat/skillSuggestParser';

/**
 * Format a timestamp for message display.
 * Today: "HH:mm", older: "MM-DD HH:mm".
 */
export const formatMessageTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const time = `${hours}:${minutes}`;

  if (
    date.getFullYear() !== now.getFullYear() ||
    date.getMonth() !== now.getMonth() ||
    date.getDate() !== now.getDate()
  ) {
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${month}-${day} ${time}`;
  }
  return time;
};
import MessageCronBadge from './MessageCronBadge';
import { resolveAgentLogo, useAgentLogos } from '@/renderer/utils/model/agentLogo';
import TeammateMessageAvatar from './TeammateMessageAvatar';

const CODE_STYLE = { marginTop: 4, marginBlock: 4 };

type WorkspaceRefreshEvent = 'aionrs.workspace.refresh' | 'acp.workspace.refresh' | 'codex.workspace.refresh';

const parseFileMarker = (content: string) => {
  const markerIndex = content.indexOf(LINGAI_FILES_MARKER);
  if (markerIndex === -1) {
    return { text: content, files: [] as string[] };
  }
  const text = content.slice(0, markerIndex).trimEnd();
  const afterMarker = content.slice(markerIndex + LINGAI_FILES_MARKER.length).trim();
  const files = afterMarker
    ? afterMarker
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
  return { text, files };
};

const isAbsoluteMessageFilePath = (file_path: string): boolean =>
  file_path.startsWith('/') || /^[A-Za-z]:/.test(file_path);

const getErrorStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object' || !('status' in error)) {
    return undefined;
  }

  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
};

const isTimeTravelUnsupportedError = (error: unknown): boolean => {
  const status = getErrorStatus(error);
  return status === 404 || status === 501;
};

const getPreviewChanges = (preview: ConversationTimeTravelPreview) =>
  Array.isArray(preview.changes) ? preview.changes : [];

const getPreviewChangeCount = (preview: ConversationTimeTravelPreview): number =>
  preview.change_count ?? getPreviewChanges(preview).length;

export const resolveMessageFilePath = (file_path: string, workspace?: string): string => {
  if (!file_path || isAbsoluteMessageFilePath(file_path) || !workspace) {
    return file_path;
  }

  const normalizedWorkspace = workspace.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  const normalizedFilePath = file_path.replace(/^\.?[\\/]+/, '').replace(/\\/g, '/');
  return `${normalizedWorkspace}/${normalizedFilePath}`.replace(/\/+/g, '/');
};

const useFormatContent = (content: string) => {
  return useMemo(() => {
    try {
      const json = JSON.parse(content);
      const isJson = typeof json === 'object';
      return {
        json: isJson,
        data: isJson ? json : content,
      };
    } catch {
      return { data: content };
    }
  }, [content]);
};

const TYPEWRITER_FRAME_MS = 16;
const TYPEWRITER_MIN_CHARS = 2;
const TYPEWRITER_MAX_CHARS = 24;
const TYPEWRITER_CATCH_UP_FRAMES = 24;

const getTypewriterBatchSize = (remainingText: string) => {
  const remainingLength = Array.from(remainingText).length;
  return Math.min(
    TYPEWRITER_MAX_CHARS,
    Math.max(TYPEWRITER_MIN_CHARS, Math.ceil(remainingLength / TYPEWRITER_CATCH_UP_FRAMES))
  );
};

const appendTypewriterChunk = (current: string, target: string) => {
  if (!target.startsWith(current)) {
    return target;
  }
  const remaining = target.slice(current.length);
  if (!remaining) {
    return current;
  }
  const chunkSize = getTypewriterBatchSize(remaining);
  return current + Array.from(remaining).slice(0, chunkSize).join('');
};

const useTypewriterText = (targetText: string, enabled: boolean) => {
  const [displayedText, setDisplayedText] = useState(targetText);

  useEffect(() => {
    setDisplayedText((current) => {
      if (targetText.startsWith(current)) {
        return current;
      }
      return targetText;
    });
  }, [targetText]);

  useEffect(() => {
    if (!enabled && displayedText === targetText) {
      return undefined;
    }
    if (!targetText.startsWith(displayedText) || displayedText === targetText) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setDisplayedText((current) => appendTypewriterChunk(current, targetText));
    }, TYPEWRITER_FRAME_MS);

    return () => window.clearInterval(timer);
  }, [displayedText, enabled, targetText]);

  return displayedText;
};

const MessageText: React.FC<{ message: IMessageText; showCopyRow?: boolean; reserveCopyRowSpace?: boolean }> = ({
  message,
  showCopyRow = true,
  reserveCopyRowSpace = false,
}) => {
  const logos = useAgentLogos();
  // Filter think tags from content before rendering
  // 在渲染前过滤 think 标签
  const contentToRender = useMemo(() => {
    let content = message.content.content;
    if (typeof content === 'string') {
      if (hasThinkTags(content)) {
        content = stripThinkTags(content);
      }
      // Strip any inline [SKILL_SUGGEST] blocks (now handled via separate skill_suggest message type)
      if (hasSkillSuggest(content)) {
        content = stripSkillSuggest(content);
      }
      return content;
    }
    return content;
  }, [message.content.content]);

  const isUserMessage = message.position === 'right';
  const { text, files } = isUserMessage
    ? parseFileMarker(contentToRender)
    : { text: contentToRender, files: [] as string[] };
  const { data, json } = useFormatContent(text);
  const { t } = useTranslation();
  const [showCopyAlert, setShowCopyAlert] = useState(false);
  const [timeTravelLoading, setTimeTravelLoading] = useState(false);
  const isTeammateMessage = message.position === 'left' && message.content.teammateMessage === true;
  const isCommentaryMessage =
    message.position === 'left' && !isTeammateMessage && message.content.phase === 'commentary';
  const shouldRenderPlainText = isUserMessage || isCommentaryMessage;
  const cronMeta = message.content.cronMeta;
  const isStreamingAssistantText =
    message.position === 'left' &&
    !isTeammateMessage &&
    !cronMeta &&
    (message.status === 'work' || message.status === 'pending');
  const displayText = useTypewriterText(text, isStreamingAssistantText && !json);
  const isTypewriterActive = !shouldRenderPlainText && !json && displayText !== text;
  const showTypewriterCursor = !shouldRenderPlainText && !json && (isStreamingAssistantText || isTypewriterActive);
  const conversationContext = useConversationContextSafe();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const handleLocalFileLink = useLocalFilePreview(conversationContext?.workspace);
  const resolvedFiles = useMemo(
    () => files.map((file_path) => resolveMessageFilePath(file_path, conversationContext?.workspace)),
    [conversationContext?.workspace, files]
  );

  // 过滤空内容，避免渲染空DOM
  if (!message.content.content || (typeof message.content.content === 'string' && !message.content.content.trim())) {
    return null;
  }

  const handleCopy = () => {
    const baseText = shouldRenderPlainText ? text : json ? JSON.stringify(data, null, 2) : text;
    const fileList = files.length ? `Files:\n${files.map((path) => `- ${path}`).join('\n')}\n\n` : '';
    const textToCopy = fileList + baseText;
    copyText(textToCopy)
      .then(() => {
        setShowCopyAlert(true);
        setTimeout(() => setShowCopyAlert(false), 2000);
      })
      .catch(() => {
        Message.error(t('common.copyFailed'));
      });
  };

  const handleFillSendBox = () => {
    emitter.emit('sendbox.fill', text);
  };

  const handleTimeTravel = async () => {
    const conversationId = conversationContext?.conversation_id || message.conversation_id;
    const workspace = conversationContext?.workspace;
    const messageId = message.msg_id || message.id;

    if (!conversationId || !workspace || !messageId) {
      Message.warning(t('messages.timeTravel.noWorkspace'));
      return;
    }

    setTimeTravelLoading(true);
    try {
      const preview = await ipcBridge.conversation.previewTimeTravel.invoke({
        conversation_id: conversationId,
        message_id: messageId,
        workspace,
      });

      if (!preview.available) {
        Message.warning(t('messages.timeTravel.unavailable'));
        return;
      }

      const changeCount = getPreviewChangeCount(preview);
      const previewChanges = getPreviewChanges(preview);
      const previewFiles = previewChanges.slice(0, 5);
      const hiddenFileCount = Math.max(0, changeCount - previewFiles.length);

      Modal.confirm({
        title: t('messages.timeTravel.previewTitle'),
        okText: t('messages.timeTravel.confirm'),
        cancelText: t('common.cancel'),
        okButtonProps: { status: 'danger' },
        content: (
          <div className='flex flex-col gap-8px'>
            <div>{t('messages.timeTravel.previewDescription')}</div>
            <div className='text-12px text-t-secondary'>
              {t('messages.timeTravel.fileChangeCount', { count: changeCount })}
            </div>
            {previewFiles.length > 0 && (
              <div className='max-h-160px overflow-y-auto rounded-8px bg-fill-1 p-8px text-12px'>
                {previewFiles.map((change) => (
                  <div key={`${change.operation}:${change.file_path}`} className='truncate text-t-secondary'>
                    {change.relative_path || change.file_path}
                  </div>
                ))}
                {hiddenFileCount > 0 && (
                  <div className='text-t-secondary'>
                    {t('messages.timeTravel.moreFiles', { count: hiddenFileCount })}
                  </div>
                )}
              </div>
            )}
            {preview.message_delete_count ? (
              <div className='text-12px text-t-secondary'>
                {t('messages.timeTravel.messageDeleteHint', { count: preview.message_delete_count })}
              </div>
            ) : null}
          </div>
        ),
        onOk: async () => {
          try {
            const result = await ipcBridge.conversation.restoreTimeTravel.invoke({
              conversation_id: conversationId,
              message_id: messageId,
              workspace,
              create_backup: true,
            });

            Message.success(
              result.backup_path
                ? t('messages.timeTravel.restoreSuccessWithBackup', { path: result.backup_path })
                : t('messages.timeTravel.restoreSuccess')
            );
            emitter.emit('conversation.messages.refresh', conversationId);
            emitter.emit('chat.history.refresh');
            emitter.emit(`${conversationContext?.type ?? 'acp'}.workspace.refresh` as WorkspaceRefreshEvent);
          } catch (error) {
            Message.error(
              isTimeTravelUnsupportedError(error)
                ? t('messages.timeTravel.backendUnsupported')
                : t('messages.timeTravel.restoreFailed')
            );
            throw error;
          }
        },
      });
    } catch (error) {
      Message.warning(
        isTimeTravelUnsupportedError(error)
          ? t('messages.timeTravel.backendUnsupported')
          : t('messages.timeTravel.previewFailed')
      );
    } finally {
      setTimeTravelLoading(false);
    }
  };

  const actionClassName =
    'p-4px rd-4px cursor-pointer hover:bg-3 transition-colors opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto';

  const refillButton = isUserMessage ? (
    <Tooltip content={t('messages.fillSendboxForResend')}>
      <div className={actionClassName} onClick={handleFillSendBox} style={{ lineHeight: 0 }}>
        <ReplayMusic theme='outline' size='16' fill={iconColors.secondary} />
      </div>
    </Tooltip>
  ) : null;

  const copyButton = (
    <Tooltip content={t('common.copy', { defaultValue: 'Copy' })}>
      <div className={actionClassName} onClick={handleCopy} style={{ lineHeight: 0 }}>
        <Copy theme='outline' size='16' fill={iconColors.secondary} />
      </div>
    </Tooltip>
  );

  const timeTravelButton =
    conversationContext && !isCommentaryMessage ? (
      <Tooltip content={t('messages.timeTravel.tooltip')}>
        <Button
          aria-label={t('messages.timeTravel.tooltip')}
          type='text'
          size='mini'
          loading={timeTravelLoading}
          className={`${actionClassName} !h-auto !border-none !bg-transparent !p-4px !shadow-none`}
          onClick={handleTimeTravel}
          style={{ lineHeight: 0 }}
        >
          <History theme='outline' size='16' fill={iconColors.secondary} />
        </Button>
      </Tooltip>
    ) : null;

  const senderName = message.content.senderName;
  const senderAgentType = message.content.senderAgentType;
  const senderConversationId = message.content.senderConversationId;
  const fallbackBackendLogo = senderAgentType ? resolveAgentLogo(logos, { backend: senderAgentType }) : null;

  return (
    <>
      <div className={classNames('min-w-0 flex flex-col group', isUserMessage ? 'items-end' : 'items-start')}>
        {cronMeta && <MessageCronBadge meta={cronMeta} />}
        {isTeammateMessage && senderName && (
          <div className='flex items-center gap-6px mb-4px'>
            <TeammateMessageAvatar
              senderName={senderName}
              senderConversationId={senderConversationId}
              backendLogo={fallbackBackendLogo}
            />
            <span className='text-12px text-t-secondary'>{senderName}</span>
          </div>
        )}
        {files.length > 0 && (
          <div className={classNames('mt-6px', { 'self-end': isUserMessage })}>
            {resolvedFiles.length === 1 ? (
              <div className='flex items-center'>
                <FilePreview path={resolvedFiles[0]} onRemove={() => undefined} readonly />
              </div>
            ) : (
              <HorizontalFileList>
                {resolvedFiles.map((path) => (
                  <FilePreview key={path} path={path} onRemove={() => undefined} readonly />
                ))}
              </HorizontalFileList>
            )}
          </div>
        )}
        <div
          className={classNames('min-w-0 [&>p:first-child]:mt-0px [&>p:last-child]:mb-0px', {
            'bg-aou-2 p-6px md:p-8px': isUserMessage || cronMeta,
            'bg-3 p-6px md:p-8px': isTeammateMessage,
            'w-full': !(isUserMessage || cronMeta || isTeammateMessage || isCommentaryMessage),
            'max-w-[88%] rd-8px border-l-2 border-l-solid border-primary bg-fill-1 px-10px py-6px text-13px text-t-secondary':
              isCommentaryMessage,
          })}
          style={{
            ...(isUserMessage || cronMeta
              ? { borderRadius: '8px 0 8px 8px', color: 'var(--text-primary)' }
              : isTeammateMessage
                ? { borderRadius: '0 8px 8px 8px' }
                : undefined),
          }}
        >
          {/* JSON 内容使用折叠组件 Use CollapsibleContent for JSON content */}
          {shouldRenderPlainText ? (
            <div className='whitespace-pre-wrap break-words' data-testid='message-text-content'>
              {text}
            </div>
          ) : json ? (
            <CollapsibleContent maxHeight={200} defaultCollapsed={true}>
              <div data-testid='message-text-content'>
                <MarkdownView
                  codeStyle={CODE_STYLE}
                  onLocalFileLink={handleLocalFileLink}
                >{`\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``}</MarkdownView>
              </div>
            </CollapsibleContent>
          ) : (
            <div data-testid='message-text-content'>
              <MarkdownView codeStyle={CODE_STYLE} onLocalFileLink={handleLocalFileLink}>
                {displayText}
              </MarkdownView>
              {showTypewriterCursor && (
                <span
                  aria-hidden='true'
                  className='ml-2px inline-block h-16px w-6px animate-pulse align-text-bottom bg-[var(--text-tertiary)]'
                />
              )}
            </div>
          )}
        </div>
        {/* Hover-revealed copy + timestamp row. Mobile has no hover affordance,
            so we drop the row entirely — system-level long-press still copies.
            For AI replies split across several text messages, only the last text
            of the turn shows this row (showCopyRow); user messages always do. */}
        {!isMobile && (showCopyRow || reserveCopyRowSpace) && (
          <div
            className={classNames('h-32px flex items-center mt-4px gap-8px', {
              'flex-row-reverse': isUserMessage,
              'invisible pointer-events-none select-none': !showCopyRow,
            })}
          >
            {showCopyRow && (
              <>
                {refillButton}
                {copyButton}
                {timeTravelButton}
                {message.created_at && (
                  <span className='text-12px text-t-secondary opacity-0 group-hover:opacity-100 transition-opacity select-none'>
                    {formatMessageTime(message.created_at)}
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {showCopyAlert && (
        <Alert
          type='success'
          content={t('messages.copySuccess')}
          showIcon
          className='fixed top-20px left-50% transform -translate-x-50% z-9999 w-max max-w-[80%]'
          style={{ boxShadow: '0px 2px 12px rgba(0,0,0,0.12)' }}
          closable={false}
        />
      )}
    </>
  );
};

export default MessageText;

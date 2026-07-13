/**
 * @license
 * Copyright 2025 LingAI (lingai.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageAcpToolCall } from '@/common/chat/chatLib';
import { getAcpImageFileName, getAcpImagePath } from '@/common/chat/acpToolCallOutput';
import type { ToolCallContentItem } from '@/common/types/platform/acpTypes';
import FileChangesPanel, { type FileChangeItem } from '@/renderer/components/base/FileChangesPanel';
import ImageAttachment from '@/renderer/components/media/ImageAttachment';
import { useDiffPreviewHandlers } from '@/renderer/hooks/file/useDiffPreviewHandlers';
import { Card, Spin, Tag } from '@arco-design/web-react';
import MarkdownView from '@renderer/components/Markdown';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const StatusTag: React.FC<{ status: string }> = ({ status }) => {
  const getTagProps = () => {
    switch (status) {
      case 'pending':
        return { color: 'blue', text: 'Pending' };
      case 'in_progress':
        return { color: 'orange', text: 'In Progress' };
      default:
        return { color: 'gray', text: status };
    }
  };

  const { color, text } = getTagProps();
  return <Tag color={color}>{text}</Tag>;
};

type DiffWorkerMessage = {
  id: string;
  error?: unknown;
  formattedDiff?: string;
  fileInfo?: FileChangeItem;
};

const DiffContentView: React.FC<{ old_text: string; new_text: string; path: string }> = ({
  old_text,
  new_text,
  path,
}) => {
  const display_name = path.split(/[/\\]/).pop() || path || 'Unknown file';
  const [diffState, setDiffState] = useState<{
    isLoading: boolean;
    formattedDiff: string;
    fileInfo: FileChangeItem | null;
  }>({
    isLoading: true,
    formattedDiff: '',
    fileInfo: null,
  });

  useEffect(() => {
    setDiffState((prev) => ({ ...prev, isLoading: true }));
    const worker = new Worker(new URL('../../../../utils/file/diffWorker.ts', import.meta.url), { type: 'module' });
    const id = Date.now().toString();

    worker.onmessage = (event: MessageEvent<DiffWorkerMessage>) => {
      if (event.data.id !== id) return;
      if (event.data.error) {
        console.error('Diff generation error:', event.data.error);
        setDiffState({ isLoading: false, formattedDiff: '', fileInfo: null });
      } else {
        setDiffState({
          isLoading: false,
          formattedDiff: event.data.formattedDiff || '',
          fileInfo: event.data.fileInfo || null,
        });
      }
      worker.terminate();
    };

    worker.postMessage({ id, old_text, new_text, path });
    return () => worker.terminate();
  }, [old_text, new_text, path]);

  const { handleFileClick, handleDiffClick } = useDiffPreviewHandlers({
    diffText: diffState.formattedDiff,
    display_name,
    file_path: path || display_name,
  });

  if (diffState.isLoading) {
    return (
      <div className='flex items-center justify-center p-4 mt-3 bg-1 rounded border'>
        <Spin tip='Generating diff...' />
      </div>
    );
  }

  if (!diffState.fileInfo) {
    return <div className='p-2 text-t-secondary text-sm'>Failed to generate diff.</div>;
  }

  return (
    <FileChangesPanel
      title={display_name}
      files={[diffState.fileInfo]}
      onFileClick={handleFileClick}
      onDiffClick={handleDiffClick}
      defaultExpanded={true}
    />
  );
};

const ContentView: React.FC<{ content: ToolCallContentItem }> = ({ content }) => {
  if (content.type === 'diff') {
    return (
      <DiffContentView old_text={content.old_text || ''} new_text={content.new_text || ''} path={content.path || ''} />
    );
  }

  if (content.type === 'content' && content.content?.type === 'text' && content.content.text) {
    return (
      <div className='mt-3'>
        <div className='bg-1 p-3 rounded border overflow-hidden'>
          <div className='overflow-x-auto break-words'>
            <MarkdownView>{content.content.text}</MarkdownView>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

const getKindDisplayName = (toolKind: string) => {
  switch (toolKind) {
    case 'edit':
      return 'File Edit';
    case 'read':
      return 'File Read';
    case 'execute':
      return 'Shell Command';
    default:
      return toolKind;
  }
};

const MessageAcpToolCall: React.FC<{ message: IMessageAcpToolCall }> = ({ message }) => {
  const { t } = useTranslation();
  const { content } = message;
  if (!content?.update) {
    return null;
  }

  const { update } = content;
  const { tool_call_id, kind, title, status, rawInput, content: diffContent } = update;
  const imagePath = getAcpImagePath(update);
  const imageAlt = imagePath?.split(/[/\\]/).pop() || t('acp.image.generated_alt');

  return (
    <Card className='w-full mb-2' size='small' bordered>
      <div className='flex items-start gap-3'>
        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-2 mb-2'>
            <span className='font-medium text-t-primary'>{title || getKindDisplayName(kind)}</span>
            <StatusTag status={status} />
          </div>
          {rawInput && (
            <div className='text-sm'>
              {typeof rawInput === 'string' ? (
                <MarkdownView>{'````\n' + rawInput + '\n````'}</MarkdownView>
              ) : (
                <pre className='bg-1 p-2 rounded text-xs overflow-x-auto'>{JSON.stringify(rawInput, null, 2)}</pre>
              )}
            </div>
          )}
          {imagePath && (
            <ImageAttachment
              src={imagePath}
              alt={imageAlt}
              fileName={getAcpImageFileName(imagePath)}
              className='mt-3'
            />
          )}
          {diffContent && diffContent.length > 0 && (
            <div>
              {diffContent.map((item, index) => (
                <ContentView key={index} content={item} />
              ))}
            </div>
          )}
          <div className='text-xs text-t-secondary mt-2'>Tool Call ID: {tool_call_id}</div>
        </div>
      </div>
    </Card>
  );
};

export default MessageAcpToolCall;

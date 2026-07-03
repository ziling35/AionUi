import type { BadgeProps } from '@arco-design/web-react';
import { Badge, Button, Message, Spin, Tooltip } from '@arco-design/web-react';
import { IconDown, IconRight } from '@arco-design/web-react/icon';
import { Checklist, Code, Download, FileSearch, Magic, Right, Search, Terminal, Write } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { getAcpImageFileName } from '@/common/chat/acpToolCallOutput';
import type { NormalizedToolCall, NormalizedToolStatus, ToolMessage } from '@/common/chat/normalizeToolCall';
import { normalizeToolMessages, hasRunningToolMessages } from '@/common/chat/normalizeToolCall';
import LocalImageView from '@/renderer/components/media/LocalImageView';
import { downloadFileFromPath } from '@/renderer/utils/file/download';
import './MessageToolGroupSummary.css';

const statusToBadge = (status: NormalizedToolStatus): BadgeProps['status'] => {
  switch (status) {
    case 'completed':
      return 'success';
    case 'error':
      return 'error';
    case 'running':
      return 'processing';
    case 'canceled':
      return 'default';
    case 'pending':
    default:
      return 'default';
  }
};

const getToolDisplayMeta = (item: NormalizedToolCall) => {
  const text = `${item.name} ${item.description || ''}`.toLowerCase();
  if (text.includes('glob') || text.includes('search') || text.includes('grep')) {
    return { icon: <Search theme='outline' size='14' />, action: '正在扫描项目', detail: item.description || '定位相关文件和上下文' };
  }
  if (text.includes('read')) {
    return { icon: <FileSearch theme='outline' size='14' />, action: '正在阅读文件', detail: item.description || '理解代码结构' };
  }
  if (text.includes('write') || text.includes('edit') || text.includes('replace')) {
    return { icon: <Write theme='outline' size='14' />, action: '正在写入改动', detail: item.description || '应用代码修改' };
  }
  if (text.includes('command') || text.includes('shell') || text.includes('terminal')) {
    return { icon: <Terminal theme='outline' size='14' />, action: '正在执行命令', detail: item.description || '验证或运行任务' };
  }
  return {
    icon: <Code theme='outline' size='14' />,
    action: item.status === 'running' ? '正在处理任务' : '已处理任务',
    detail: item.description || item.name,
  };
};

const getProgressCopy = (tools: NormalizedToolCall[], hasRunning: boolean) => {
  const running = tools.find((item) => item.status === 'running') || tools.find((item) => item.status === 'pending');
  const completedCount = tools.filter((item) => item.status === 'completed').length;
  const percent = tools.length > 0 ? Math.max(8, Math.round((completedCount / tools.length) * 100)) : hasRunning ? 18 : 100;
  const meta = running ? getToolDisplayMeta(running) : undefined;

  return {
    percent: hasRunning ? Math.min(percent, 92) : 100,
    title: hasRunning ? meta?.action || '正在推进任务' : '步骤已完成',
    detail: hasRunning ? meta?.detail || 'AI 正在分析、读取或写入，请稍候' : `已完成 ${completedCount}/${tools.length || 1} 个步骤`,
    completedCount,
  };
};

const ToolItemDetail: React.FC<{ item: NormalizedToolCall }> = ({ item }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [fullItem, setFullItem] = useState<NormalizedToolCall | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const displayItem = fullItem ?? item;
  const hasDetail = displayItem.input || displayItem.output || item.truncated || displayItem.imagePath;
  const meta = getToolDisplayMeta(displayItem);
  const [messageApi, messageContext] = Message.useMessage();
  const handleDownloadImage = useCallback(
    async (path: string) => {
      try {
        await downloadFileFromPath(path, getAcpImageFileName(path));
        messageApi.success(t('acp.image.download_success'));
      } catch (error) {
        console.error('[MessageToolGroupSummary] Failed to download image:', error);
        messageApi.error(t('acp.image.download_error'));
      }
    },
    [messageApi, t]
  );

  const loadFullItem = async () => {
    if (!item.truncated || fullItem || loadingFull || !item.conversationId || !item.messageId) return;
    setLoadingFull(true);
    setLoadError(false);
    try {
      const message = await ipcBridge.database.getConversationMessage.invoke({
        conversation_id: item.conversationId,
        message_id: item.messageId,
      });
      const next = normalizeToolMessages([message as ToolMessage]).find((candidate) => candidate.key === item.key);
      if (next) setFullItem(next);
    } catch {
      setLoadError(true);
    } finally {
      setLoadingFull(false);
    }
  };

  const toggleExpanded = () => {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded) void loadFullItem();
  };

  return (
    <div className={`tool-step-card tool-step-card--${item.status}`}>
      {messageContext}
      <div className='tool-step-card__main'>
        <span className='tool-step-card__icon'>{meta.icon}</span>
        <span
          className={
            'tool-step-card__content' +
            (expanded ? ' break-all' : ' truncate') +
            (hasDetail ? ' cursor-pointer' : '')
          }
          onClick={hasDetail ? toggleExpanded : undefined}
        >
          <span className='tool-step-card__title'>{meta.action}</span>
          {displayItem.description && displayItem.description !== displayItem.name && (
            <span className='tool-step-card__desc'>{displayItem.description}</span>
          )}
        </span>
        <Badge status={statusToBadge(item.status)} className={item.status === 'running' ? 'badge-breathing' : ''} />
        {hasDetail && (
          <span className='tool-step-card__arrow' onClick={toggleExpanded}>
            {expanded ? <IconDown style={{ fontSize: 12 }} /> : <IconRight style={{ fontSize: 12 }} />}
          </span>
        )}
      </div>
      {expanded && hasDetail && (
        <div className='tool-detail-panel m-l-20px m-t-4px'>
          {loadingFull && <div className='tool-detail-label'>Loading...</div>}
          {loadError && <div className='tool-detail-label'>Failed to load full output</div>}
          {displayItem.input && (
            <div className='tool-detail-section'>
              <div className='tool-detail-label'>Input</div>
              <pre className='tool-detail-content'>{displayItem.input}</pre>
            </div>
          )}
          {displayItem.output && (
            <div className='tool-detail-section'>
              <div className='tool-detail-label'>Output</div>
              <pre className='tool-detail-content'>{displayItem.output}</pre>
            </div>
          )}
        </div>
      )}
      {displayItem.imagePath && (
        <div className='group relative m-l-20px m-t-8px overflow-hidden rounded border bg-1 p-2 max-w-280px'>
          <LocalImageView
            src={displayItem.imagePath}
            alt={getAcpImageFileName(displayItem.imagePath)}
            className='max-w-full max-h-320px object-contain rounded'
          />
          <Tooltip content={t('acp.image.download')}>
            <Button
              aria-label={t('acp.image.download_aria')}
              className='!absolute right-10px top-10px !h-28px !w-28px !p-0 opacity-0 shadow-sm transition-opacity group-hover:opacity-90 focus:opacity-100'
              type='secondary'
              size='mini'
              shape='circle'
              icon={<Download theme='outline' size='14' />}
              onClick={() => void handleDownloadImage(displayItem.imagePath!)}
            />
          </Tooltip>
        </div>
      )}
    </div>
  );
};

const MessageToolGroupSummary: React.FC<{ messages: ToolMessage[] }> = ({ messages }) => {
  const hasRunning = hasRunningToolMessages(messages);
  const [showMore, setShowMore] = useState(hasRunning);

  useEffect(() => {
    if (hasRunning) setShowMore(true);
  }, [hasRunning]);

  const tools = useMemo(() => normalizeToolMessages(messages), [messages]);
  const progress = useMemo(() => getProgressCopy(tools, hasRunning), [hasRunning, tools]);

  return (
    <div className={`tool-group-summary${hasRunning ? ' tool-group-summary--running' : ''}`}>
      <div className='tool-progress-hero' onClick={() => setShowMore(!showMore)}>
        <div className='tool-progress-hero__orb'>
          {hasRunning ? <Magic theme='outline' size='16' /> : <Checklist theme='outline' size='16' />}
        </div>
        <div className='tool-progress-hero__content'>
          <div className='tool-progress-hero__title'>{progress.title}</div>
          <div className='tool-progress-hero__detail'>{progress.detail}</div>
          <div className='tool-progress-hero__bar'>
            <span style={{ width: `${progress.percent}%` }} />
          </div>
        </div>
        <div className='tool-progress-hero__count'>
          {progress.completedCount}/{tools.length || 1}
        </div>
      </div>
      <div className='tool-group-summary__header' onClick={() => setShowMore(!showMore)}>
        <span className='tool-group-summary__icon'>
          {hasRunning ? <Spin size={12} /> : <Checklist theme='outline' size='14' />}
        </span>
        <span className='tool-group-summary__label'>{hasRunning ? '实时步骤' : '查看步骤'} {tools.length > 0 ? `· ${tools.length}` : ''}</span>
        <span className={`tool-group-summary__arrow${showMore ? ' tool-group-summary__arrow--open' : ''}`}>
          <Right theme='outline' size='12' />
        </span>
      </div>
      {showMore && (
        <div className='tool-group-summary__body'>
          {tools.map((item) => (
            <ToolItemDetail key={item.key} item={item} />
          ))}
        </div>
      )}
    </div>
  );
};

export default React.memo(MessageToolGroupSummary);
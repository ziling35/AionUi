/**
 * @license
 * Copyright 2025 LingAI (lingai.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageAcpPermission } from '@/common/chat/chatLib';
import { conversation } from '@/common/adapter/ipcBridge';
import { Button, Card, Radio, Typography } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

interface MessageAcpPermissionProps {
  message: IMessageAcpPermission;
}

const MessageAcpPermission: React.FC<MessageAcpPermissionProps> = React.memo(({ message }) => {
  const { options = [], tool_call } = message.content || {};
  const { t } = useTranslation();

  // 基于实际数据生成显示信息
  const getToolInfo = () => {
    if (!tool_call) {
      return {
        title: t('messages.permissionRequest'),
        description: t('messages.agentRequestingPermission'),
        icon: '🔐',
      };
    }

    const displayTitle = tool_call.title || tool_call.raw_input?.description || t('messages.permissionRequest');

    // 简单的图标映射
    const kindIcons: Record<string, string> = {
      edit: '✏️',
      read: '📖',
      fetch: '🌐',
      execute: '⚡',
    };

    return {
      title: displayTitle,
      icon: kindIcons[tool_call.kind || 'execute'] || '⚡',
    };
  };
  const { title, icon } = getToolInfo();
  const [selected, setSelected] = useState<string | null>(null);
  const [isResponding, setIsResponding] = useState(false);
  const [hasResponded, setHasResponded] = useState(false);

  const handleConfirmOption = async (option_id: string) => {
    if (hasResponded) return;

    setIsResponding(true);
    setSelected(option_id);
    try {
      const invokeData = {
        confirm_key: option_id,
        msg_id: message.id,
        conversation_id: message.conversation_id,
        call_id: tool_call?.tool_call_id || message.id,
      };

      await conversation.confirmMessage.invoke(invokeData);
      setHasResponded(true);
    } catch (error) {
      console.error('Error confirming permission:', error);
    } finally {
      setIsResponding(false);
    }
  };

  if (!tool_call) {
    return null;
  }

  return (
    <Card
      className='mb-4'
      bordered={false}
      style={{ background: 'var(--bg-1)' }}
      data-testid='message-acp-permission-card'
    >
      <div className='space-y-4'>
        {/* Header with icon and title */}
        <div className='flex items-center space-x-2'>
          <span className='text-2xl'>{icon}</span>
          <Text className='block'>{title}</Text>
        </div>
        {(tool_call.raw_input?.command || tool_call.title) && (
          <div>
            <Text className='text-xs text-t-secondary mb-1'>{t('messages.command')}</Text>
            <code className='text-xs bg-1 p-2 rounded block text-t-primary break-all'>
              {tool_call.raw_input?.command || tool_call.title}
            </code>
          </div>
        )}
        {!hasResponded && (
          <div className='flex items-center gap-3 mt-4'>
            {options && options.length > 0 ? (
              options.map((option, index) => {
                const optionName = option?.name || `${t('messages.option')} ${index + 1}`;
                const option_id = option?.option_id || `option_${index}`;
                
                const isAccept = option_id.toLowerCase().includes('allow') || option_id.toLowerCase().includes('accept') || option_id.toLowerCase().includes('yes');
                const isReject = option_id.toLowerCase().includes('deny') || option_id.toLowerCase().includes('reject') || option_id.toLowerCase().includes('no');
                
                let buttonType: any = 'secondary';
                let icon = null;
                let className = 'flex-1 font-medium';
                
                if (isAccept) {
                  buttonType = 'primary';
                  icon = <span className="mr-1">✓</span>;
                } else if (isReject) {
                  buttonType = 'secondary';
                  icon = <span className="mr-1 text-red-500">✗</span>;
                  className = 'flex-1 !text-red-500 !bg-red-50 hover:!bg-red-100 !border-red-200 font-medium';
                }

                return (
                  <Button
                    key={option_id}
                    type={buttonType}
                    className={className}
                    disabled={isResponding}
                    onClick={() => handleConfirmOption(option_id)}
                    data-testid={`message-acp-permission-option-${option_id}`}
                  >
                    <span className="flex items-center justify-center">
                      {icon} {optionName}
                    </span>
                  </Button>
                );
              })
            ) : (
              <Text type='secondary'>{t('messages.noOptionsAvailable')}</Text>
            )}
          </div>
        )}

        {hasResponded && (
          <div
            className='mt-10px p-2 rounded-md border'
            style={{ backgroundColor: 'var(--color-success-light-1)', borderColor: 'rgb(var(--success-3))' }}
          >
            <Text className='text-sm' style={{ color: 'rgb(var(--success-6))' }}>
              ✓ {t('messages.responseSentSuccessfully')}
            </Text>
          </div>
        )}
      </div>
    </Card>
  );
});

export default MessageAcpPermission;

import { ipcBridge } from '@/common';
import {
  buildCloudHistoryImportPayload,
  cloudHistoryApi,
  type CloudHistoryConversationItem,
} from '@renderer/api/cloudHistory';
import { emitter } from '@renderer/utils/emitter';
import { Button, Empty, Message, Modal, Spin } from '@arco-design/web-react';
import { CloudStorage, Download } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

type CloudHistoryRestoreModalProps = {
  visible: boolean;
  token: string | null;
  onClose: () => void;
};

const formatHistoryTime = (value: string | null | undefined): string => {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString();
};

const CloudHistoryRestoreModal: React.FC<CloudHistoryRestoreModalProps> = ({ visible, token, onClose }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<CloudHistoryConversationItem[]>([]);

  const loadConversations = useCallback(async () => {
    if (!token) {
      setConversations([]);
      return;
    }

    setLoading(true);
    try {
      setConversations(await cloudHistoryApi.listConversations(token));
    } catch (error) {
      console.error('[CloudHistoryRestoreModal] Failed to list cloud history:', error);
      Message.error(t('settings.accountPanel.cloudHistoryRestoreLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t, token]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    void loadConversations();
  }, [loadConversations, visible]);

  const handleRestore = useCallback(
    async (conversation: CloudHistoryConversationItem) => {
      if (!token || restoringId) {
        return;
      }

      setRestoringId(conversation.id);
      try {
        const messages = await cloudHistoryApi.getMessages(token, conversation.id);
        const result = await ipcBridge.conversationImport.importFromPayload.invoke({
          payload: buildCloudHistoryImportPayload(conversation, messages),
        });
        emitter.emit('chat.history.refresh');
        Message.success(
          t('settings.accountPanel.cloudHistoryRestoreSuccess', {
            count: result.importedCount,
            messages: result.messageCount,
          })
        );
        onClose();
        const firstConversationId = result.conversationIds[0];
        if (firstConversationId) {
          void navigate(`/conversation/${firstConversationId}`);
        }
      } catch (error) {
        console.error('[CloudHistoryRestoreModal] Failed to restore cloud history:', error);
        Message.error(t('settings.accountPanel.cloudHistoryRestoreFailed'));
      } finally {
        setRestoringId(null);
      }
    },
    [navigate, onClose, restoringId, t, token]
  );

  return (
    <Modal
      visible={visible}
      title={t('settings.accountPanel.cloudHistoryRestoreTitle')}
      footer={null}
      onCancel={onClose}
      unmountOnExit
    >
      <div className='flex flex-col gap-12px'>
        <p className='text-13px text-t-secondary leading-relaxed mb-4px'>
          {t('settings.accountPanel.cloudHistoryRestoreDesc')}
        </p>
        <Spin loading={loading}>
          {conversations.length === 0 ? (
            <Empty description={t('settings.accountPanel.cloudHistoryRestoreEmpty')} />
          ) : (
            <div className='flex flex-col gap-10px max-h-420px overflow-auto pr-4px'>
              {conversations.map((conversation) => (
                <div
                  key={conversation.id}
                  className='rounded-10px border border-[var(--border-base)] bg-fill-1 p-12px flex items-center gap-12px'
                >
                  <span className='inline-flex items-center justify-center size-32px rounded-8px bg-2 text-t-secondary'>
                    <CloudStorage theme='outline' size='18' />
                  </span>
                  <div className='min-w-0 flex-1'>
                    <div className='text-14px font-600 text-t-primary truncate'>{conversation.name}</div>
                    <div className='text-12px text-t-tertiary mt-2px'>
                      {t('settings.accountPanel.cloudHistoryRestoreMeta', {
                        messages: conversation.messageCount,
                        time: formatHistoryTime(conversation.localUpdatedAt || conversation.syncedAt),
                      })}
                    </div>
                  </div>
                  <Button
                    size='small'
                    type='primary'
                    icon={<Download theme='outline' size='14' />}
                    loading={restoringId === conversation.id}
                    disabled={Boolean(restoringId && restoringId !== conversation.id)}
                    onClick={() => {
                      void handleRestore(conversation);
                    }}
                  >
                    {t('settings.accountPanel.cloudHistoryRestoreAction')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Spin>
      </div>
    </Modal>
  );
};

export default CloudHistoryRestoreModal;

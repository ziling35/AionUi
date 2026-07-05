import { ipcBridge } from '@/common';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { emitter } from '@/renderer/utils/emitter';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { Message } from '@arco-design/web-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSWRConfig } from 'swr';

const getImportErrorKey = (error: unknown): string => {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('unsupported_import_version')) return 'conversation.history.importUnsupportedVersion';
  if (message.includes('unsupported_import_file')) return 'conversation.history.importUnsupportedFile';
  if (message.includes('no_importable_conversations')) return 'conversation.history.importNoConversations';
  if (message.includes('unsupported_team_archive_version')) return 'conversation.history.importUnsupportedVersion';
  if (message.includes('invalid_team_archive')) return 'conversation.history.importInvalidFile';
  if (message.includes('invalid_import')) return 'conversation.history.importInvalidFile';
  return 'conversation.history.importFailed';
};

export const useImport = () => {
  const [importLoading, setImportLoading] = useState(false);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { mutate } = useSWRConfig();

  const handleImport = useCallback(async () => {
    if (importLoading) return;
    if (!isElectronDesktop()) {
      Message.warning(t('conversation.history.importDesktopOnly'));
      return;
    }

    try {
      const paths = await ipcBridge.dialog.showOpen.invoke({
        properties: ['openFile'],
        filters: [
          {
            name: t('conversation.history.importFileFilter'),
            extensions: ['zip', 'json'],
          },
        ],
      });
      const file_path = paths?.[0];
      if (!file_path) return;

      setImportLoading(true);
      try {
        const result = await ipcBridge.conversationImport.importFromFile.invoke({ file_path });
        emitter.emit('chat.history.refresh');
        Message.success(
          t('conversation.history.importSuccess', {
            count: result.importedCount,
            messages: result.messageCount,
          })
        );
        const firstConversationId = result.conversationIds[0];
        if (firstConversationId) {
          void navigate(`/conversation/${firstConversationId}`);
        }
        return;
      } catch (conversationError) {
        try {
          const userId = user?.id ?? 'system_default_user';
          const result = await ipcBridge.teamArchive.importFromFile.invoke({ file_path, user_id: userId });
          await mutate(`teams/${userId}`);
          Message.success(
            t('team.sider.importSuccess', {
              conversations: result.conversationCount,
              messages: result.messageCount,
              tasks: result.taskCount,
            })
          );
          void navigate(`/team/${result.teamId}`);
        } catch (teamError) {
          console.error('Failed to import local history:', { conversationError, teamError });
          Message.error(t(getImportErrorKey(teamError)));
        }
      }
    } catch (error) {
      console.error('Failed to import local history:', error);
      Message.error(t(getImportErrorKey(error)));
    } finally {
      setImportLoading(false);
    }
  }, [importLoading, mutate, navigate, t, user?.id]);

  return {
    importLoading,
    handleImport,
  };
};

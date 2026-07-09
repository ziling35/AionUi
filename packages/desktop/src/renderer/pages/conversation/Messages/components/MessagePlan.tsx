import { Badge } from '@arco-design/web-react';
import {
  IconCheckCircle,
  IconCloseCircle,
  IconDown,
  IconExclamationCircle,
  IconLoading,
  IconRight,
} from '@arco-design/web-react/icon';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IMessagePlan } from '@/common/chat/chatLib';

type PlanEntryStatus = IMessagePlan['content']['entries'][number]['status'];

const renderStatusIcon = (status: PlanEntryStatus) => {
  switch (status) {
    case 'completed':
      return <IconCheckCircle fontSize={22} strokeWidth={4} className='flex color-#00B42A' />;
    case 'in_progress':
      return <IconLoading fontSize={20} className='flex color-#165DFF animate-spin' />;
    case 'failed':
      return <IconCloseCircle fontSize={22} strokeWidth={4} className='flex color-#F53F3F' />;
    case 'cancelled':
      return <IconExclamationCircle fontSize={22} strokeWidth={4} className='flex color-#FF7D00' />;
    default:
      return (
        <div className='size-22px flex items-center justify-center'>
          <div className='size-14px rd-10px b-2px b-solid b-[rgba(201,205,212,1)]'></div>
        </div>
      );
  }
};

const MessagePlan: React.FC<{ message: IMessagePlan }> = ({ message }) => {
  const { t } = useTranslation();
  const [showMore, setShowMore] = useState(true);
  return (
    <div>
      <div className='flex items-center gap-10px color-#86909C cursor-pointer' onClick={() => setShowMore(!showMore)}>
        <Badge
          status='default'
          text={t('messages.executionPlan', { defaultValue: 'Execution plan' })}
          className={'![&_span.arco-badge-status-text]:color-#86909C'}
        ></Badge>
        {showMore ? <IconDown /> : <IconRight />}
      </div>
      {showMore && (
        <div className='p-l-20px flex flex-col gap-8px pt-8px'>
          {message.content.entries.map((item, index) => {
            return (
              <div key={`${item.content}-${index}`} className='flex flex-row items-center color-#86909C gap-8px'>
                {renderStatusIcon(item.status)}
                <span>{item.content} </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MessagePlan;

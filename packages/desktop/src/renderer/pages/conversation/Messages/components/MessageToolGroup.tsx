/**
 * @license
 * Copyright 2025 LingAI (lingai.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IMessageToolGroup } from '@/common/chat/chatLib';
import { iconColors } from '@/renderer/styles/colors';
import { Alert, Button, Radio, Tag } from '@arco-design/web-react';
import { LoadingOne } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FeedbackButton from '@/renderer/components/base/FeedbackButton';
import FileChangesPanel from '@/renderer/components/base/FileChangesPanel';
import ImageAttachment from '@renderer/components/media/ImageAttachment';
import { useDiffPreviewHandlers } from '@/renderer/hooks/file/useDiffPreviewHandlers';
import { parseDiff } from '@/renderer/utils/file/diffUtils';
import MessageFileChanges from '../MessageFileChanges';
import CollapsibleContent from '@renderer/components/chat/CollapsibleContent';
import MarkdownView from '@renderer/components/Markdown';
import { ToolConfirmationOutcome } from '@renderer/utils/common';
import { COLLAPSE_CONFIG, TEXT_CONFIG } from '../constants';
import type { ImageGenerationResult, WriteFileResult } from '../types';

const CODE_STYLE = { marginTop: 4, marginBottom: 4 };

const ALERT_CLASSES =
  '!items-start !rd-8px !px-8px [&_.arco-alert-icon]:flex [&_.arco-alert-icon]:items-start [&_.arco-alert-content-wrapper]:flex [&_.arco-alert-content-wrapper]:items-start [&_.arco-alert-content-wrapper]:w-full [&_.arco-alert-content]:flex-1';

const RESULT_MAX_HEIGHT = COLLAPSE_CONFIG.MAX_HEIGHT;

interface IMessageToolGroupProps {
  message: IMessageToolGroup;
}

const useConfirmationButtons = (
  confirmationDetails: IMessageToolGroupProps['message']['content'][number]['confirmationDetails'],
  t: (key: string, options?: any) => string
) => {
  return useMemo(() => {
    if (!confirmationDetails) return {};
    let question: string;
    const options: Array<{ label: string; value: ToolConfirmationOutcome }> = [];
    switch (confirmationDetails.type) {
      case 'edit':
        {
          question = t('messages.confirmation.applyChange');
          options.push(
            {
              label: t('messages.confirmation.yesAllowOnce'),
              value: ToolConfirmationOutcome.ProceedOnce,
            },
            {
              label: t('messages.confirmation.yesAllowAlways'),
              value: ToolConfirmationOutcome.ProceedAlways,
            },
            { label: t('messages.confirmation.no'), value: ToolConfirmationOutcome.Cancel }
          );
        }
        break;
      case 'exec':
        {
          question = t('messages.confirmation.allowExecution');
          options.push(
            {
              label: t('messages.confirmation.yesAllowOnce'),
              value: ToolConfirmationOutcome.ProceedOnce,
            },
            {
              label: t('messages.confirmation.yesAllowAlways'),
              value: ToolConfirmationOutcome.ProceedAlways,
            },
            { label: t('messages.confirmation.no'), value: ToolConfirmationOutcome.Cancel }
          );
        }
        break;
      case 'info':
        {
          question = t('messages.confirmation.proceed');
          options.push(
            {
              label: t('messages.confirmation.yesAllowOnce'),
              value: ToolConfirmationOutcome.ProceedOnce,
            },
            {
              label: t('messages.confirmation.yesAllowAlways'),
              value: ToolConfirmationOutcome.ProceedAlways,
            },
            { label: t('messages.confirmation.no'), value: ToolConfirmationOutcome.Cancel }
          );
        }
        break;
      default: {
        const mcpProps = confirmationDetails;
        question = t('messages.confirmation.allowMCPTool', {
          toolName: mcpProps.tool_name,
          serverName: mcpProps.server_name,
        });
        options.push(
          {
            label: t('messages.confirmation.yesAllowOnce'),
            value: ToolConfirmationOutcome.ProceedOnce,
          },
          {
            label: t('messages.confirmation.yesAlwaysAllowTool', {
              toolName: mcpProps.tool_name,
              serverName: mcpProps.server_name,
            }),
            value: ToolConfirmationOutcome.ProceedAlwaysTool,
          },
          {
            label: t('messages.confirmation.yesAlwaysAllowServer', {
              serverName: mcpProps.server_name,
            }),
            value: ToolConfirmationOutcome.ProceedAlwaysServer,
          },
          { label: t('messages.confirmation.no'), value: ToolConfirmationOutcome.Cancel }
        );
      }
    }
    return {
      question,
      options,
    };
  }, [confirmationDetails, t]);
};

const EditConfirmationDiff: React.FC<{ diff: string; file_name: string; title: string }> = ({
  diff,
  file_name,
  title,
}) => {
  const fileInfo = useMemo(() => parseDiff(diff, file_name), [diff, file_name]);
  const display_name = file_name.split(/[/\\]/).pop() || file_name;
  const { handleFileClick, handleDiffClick } = useDiffPreviewHandlers({
    diffText: diff,
    display_name,
    file_path: file_name,
    title,
  });

  return (
    <FileChangesPanel
      title={title}
      files={[fileInfo]}
      onFileClick={handleFileClick}
      onDiffClick={handleDiffClick}
      defaultExpanded={true}
    />
  );
};

const ConfirmationDetails: React.FC<{
  content: IMessageToolGroupProps['message']['content'][number];
  onConfirm: (outcome: ToolConfirmationOutcome) => void;
}> = ({ content, onConfirm }) => {
  const { t } = useTranslation();
  const { confirmationDetails } = content;
  if (!confirmationDetails) return;
  const node = useMemo(() => {
    if (!confirmationDetails) return null;
    switch (confirmationDetails.type) {
      case 'edit':
        return null; // Rendered separately below with hooks support
      case 'exec': {
        const bashSnippet = `\`\`\`bash\n${confirmationDetails.command}\n\`\`\``;
        return (
          <div className='w-full max-w-100% min-w-0'>
            <MarkdownView codeStyle={CODE_STYLE}>{bashSnippet}</MarkdownView>
          </div>
        );
      }
      case 'info':
        return <span className='text-t-primary'>{confirmationDetails.prompt}</span>;
      case 'mcp':
        return <span className='text-t-primary'>{confirmationDetails.tool_display_name}</span>;
    }
  }, [confirmationDetails]);

  const { question = '', options = [] } = useConfirmationButtons(confirmationDetails, t);

  const [selected, setSelected] = useState<ToolConfirmationOutcome | null>(null);

  const isConfirm = content.status === 'Confirming';

  return (
    <div>
      {confirmationDetails.type === 'edit' ? (
        <EditConfirmationDiff
          diff={confirmationDetails?.file_diff || ''}
          file_name={confirmationDetails.file_name}
          title={isConfirm ? confirmationDetails.title : content.description}
        />
      ) : (
        node
      )}
      {content.status === 'Confirming' && (
        <>
          <div className='mt-10px text-t-primary'>{question}</div>
          <Radio.Group direction='vertical' size='mini' value={selected} onChange={setSelected}>
            {options.map((item) => {
              return (
                <Radio key={item.value} value={item.value}>
                  {item.label}
                </Radio>
              );
            })}
          </Radio.Group>
          <div className='flex justify-start pl-20px'>
            <Button type='primary' size='mini' disabled={!selected} onClick={() => onConfirm(selected)}>
              {t('messages.confirm')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

const ImageDisplay: React.FC<{
  imgUrl: string;
  relativePath?: string;
}> = ({ imgUrl, relativePath }) => (
  <ImageAttachment
    src={imgUrl}
    alt={relativePath || imgUrl}
    fileName={relativePath?.split(/[\\/]/).pop()}
    className='my-8px'
  />
);

const ToolResultDisplay: React.FC<{
  content: IMessageToolGroupProps['message']['content'][number];
}> = ({ content }) => {
  const { result_display, name } = content;

  if (name === 'ImageGeneration' && typeof result_display === 'object') {
    const result = result_display as ImageGenerationResult;
    if (result.img_url) {
      return (
        <ImageAttachment
          src={result.img_url}
          alt={result.relative_path || result.img_url}
          fileName={result.relative_path?.split(/[\\/]/).pop()}
        />
      );
    }
  }

  const display = typeof result_display === 'string' ? result_display : JSON.stringify(result_display, null, 2);

  if (name === 'lingai_image_generation' && typeof display === 'string') {
    const match = display.match(/(?:Generated|Edited) image saved to:\s*([^\r\n]+?\.(?:png|jpe?g|webp|gif|bmp|svg))/i);
    if (match && match[1]) {
      const imgPath = match[1].trim();
      return (
        <div className='flex flex-col gap-2'>
          <ImageAttachment src={imgPath} alt='Generated Image' fileName={imgPath.split(/[\\/]/).pop()} />
          <CollapsibleContent maxHeight={RESULT_MAX_HEIGHT} defaultCollapsed={true} useMask={false}>
            <pre
              className='text-t-primary whitespace-pre-wrap break-words m-0'
              style={{ fontSize: TEXT_CONFIG.FONT_SIZE, lineHeight: TEXT_CONFIG.LINE_HEIGHT }}
            >
              {display}
            </pre>
          </CollapsibleContent>
        </div>
      );
    }
  }

  return (
    <CollapsibleContent maxHeight={RESULT_MAX_HEIGHT} defaultCollapsed={true} useMask={false}>
      <pre
        className='text-t-primary whitespace-pre-wrap break-words m-0'
        style={{ fontSize: TEXT_CONFIG.FONT_SIZE, lineHeight: TEXT_CONFIG.LINE_HEIGHT }}
      >
        {display}
      </pre>
    </CollapsibleContent>
  );
};

const MessageToolGroup: React.FC<IMessageToolGroupProps> = ({ message }) => {
  const { t } = useTranslation();

  // 闂傚倷娴囬妴鈧柛瀣崌閺屾盯顢曢敐鍡欘槰闂佽壈灏欐繛鈧柡宀€鍠撻崰濠偽熸潪鏉款棜闂?WriteFile 缂傚倸鍊搁崐鐑芥倿閿曞倸绠板┑鐘崇閸婅泛顭块懜闈涘闁稿鍔戦弻鏇熺箾閸喒鍋撳Δ鍛殞闁绘劦鍓氶崣蹇涙煟閻斿搫顣煎璺哄閺屽秷顧侀柛鎾寸〒閸掓帡顢涘В鑲╁枑瀵板嫬鐣濋埀顒勬儗?/ Collect all WriteFile results for summary display
  const writeFileResults = useMemo(() => {
    return message.content
      .filter(
        (item) =>
          item.name === 'WriteFile' &&
          item.result_display &&
          typeof item.result_display === 'object' &&
          'file_diff' in item.result_display
      )
      .map((item) => item.result_display as WriteFileResult);
  }, [message.content]);

  // 闂傚倷鑳堕幊鎾绘倶濮樿泛纾块柟鎯版閺勩儳鈧厜鍋撻柍褜鍓涢崚鎺楊敇閵忊晜鏅為柣鐘辫閻撳牊瀵奸崶銊х?WriteFile 闂傚倷鐒﹂惇褰掑礉瀹€鈧埀顒佸嚬閸ｏ絽鐣烽幒妤€惟闁靛鍠栧▓?/ Find the index of first WriteFile
  const firstWriteFileIndex = useMemo(() => {
    return message.content.findIndex(
      (item) =>
        item.name === 'WriteFile' &&
        item.result_display &&
        typeof item.result_display === 'object' &&
        'file_diff' in item.result_display
    );
  }, [message.content]);

  return (
    <div>
      {message.content.map((content, index) => {
        const { status, call_id, name, description, result_display, confirmationDetails } = content;
        const isLoading = status !== 'Success' && status !== 'Error' && status !== 'Canceled';
        // status === "Confirming" &&
        if (confirmationDetails) {
          return (
            <ConfirmationDetails
              key={call_id}
              content={content}
              onConfirm={(outcome) => {
                ipcBridge.conversation.confirmMessage
                  .invoke({
                    confirm_key: outcome,
                    msg_id: message.id,
                    call_id: call_id,
                    conversation_id: message.conversation_id,
                  })
                  .then(() => {
                    // confirmation sent successfully
                  })
                  .catch((error) => {
                    console.error('Failed to confirm message:', error);
                  });
              }}
            ></ConfirmationDetails>
          );
        }

        // WriteFile 闂傚倷鑳剁划顖炪€冩径鎰剁稏濠㈣埖鍔栭崑鈺呮煃閸濆嫬鈧摜娆㈤悙鐑樼厱闁哄洢鍔岄獮妤呮煕婵犲嫬浠遍柡灞诲妼閳藉鈻庨幋鐘插綆濠电姷鏁搁崑娑樏洪銏犵畺?MessageFileChanges 濠电姵顔栭崰姘跺箠閹捐秮娲晝閸屾氨鍔﹀銈嗗笒閸婅崵鏁☉娆庣箚妞ゆ牗鍑瑰Σ铏圭磼?/ WriteFile special handling: use MessageFileChanges for summary display
        if (name === 'WriteFile' && typeof result_display !== 'string') {
          if (result_display && typeof result_display === 'object' && 'file_diff' in result_display) {
            // 闂傚倷绀侀幉锟犳偡椤栨稓顩叉繝濠傚枦閼版寧銇勮箛鎾搭棤缂佺姵姊归妵鍕箣閿濆棛銆婂銈呯箰瀹曨剟鍩?WriteFile 婵犵數鍋犻幓顏嗗緤閻ｅ瞼鐭撻柛顐ｆ礃閸嬵亪鏌涢埄鍐槈闁告瑥锕弻娑㈠箻濡炵偓顦风紒顕€娼ч埞鎴︻敊閻愵剙娈屽┑鐐额嚋缁犳捇宕洪埀顒併亜閹烘垵鏆欓柛姘贡缁辨帡顢欓懖鈹絿绱?/ Only show summary component at first WriteFile position
            if (index === firstWriteFileIndex && writeFileResults.length > 0) {
              return (
                <div className='w-full min-w-0' key={call_id}>
                  <MessageFileChanges writeFileChanges={writeFileResults} />
                </div>
              );
            }
            // 闂備浇宕垫慨鎾箹椤愶附鍋柛銉㈡櫆瀹曟煡鏌涢幇闈涙灈缂佲偓閸岀偞鐓涢柛顐犲灪閺嗏晠姊?WriteFile / Skip other WriteFile
            return null;
          }
        }

        // ImageGeneration 闂傚倷鑳剁划顖炪€冩径鎰剁稏濠㈣埖鍔栭崑鈺呮煃閸濆嫬鈧摜娆㈤悙鐑樼厱闁哄洢鍔岄獮妤呮煕婵犲嫬浠遍柡灞诲妼閳藉鈻庨幒鎴闁诲氦顫夊ú婊堝窗閺嶎厼绠栨い蹇撶墱閺佸棝鏌嶈閸撶喖骞嗛崼婵愬悑闁搞儮鏅濋悞濂告⒑閸涘﹦绠撻悗姘煎幘缁宕奸妷锔惧幗濠德板€愰崑鎾寸箾閺夋垵顏俊鍙夊姇閳规垿宕堕埞鐐亙闁诲骸绠嶉崕鍗灻洪敃鍌氭辈?Alert 闂傚倷绀侀幉锟犳偋閺囥垹绠犻柟鍓х帛閺?Special handling for ImageGeneration: display image separately without Alert wrapper
        if (name === 'ImageGeneration' && typeof result_display === 'object') {
          const result = result_display as ImageGenerationResult;
          if (result.img_url) {
            return <ImageDisplay key={call_id} imgUrl={result.img_url} relativePath={result.relative_path} />;
          }
        }

        // Generic tool call display
        return (
          <div key={call_id}>
            <Alert
              className={ALERT_CLASSES}
              type={
                status === 'Error'
                  ? 'error'
                  : status === 'Success'
                    ? 'success'
                    : status === 'Canceled'
                      ? 'warning'
                      : 'info'
              }
              icon={
                isLoading && (
                  <LoadingOne theme='outline' size='12' fill={iconColors.primary} className='loading lh-[1] flex' />
                )
              }
              content={
                <div>
                  <Tag className={'mr-4px'}>
                    {name}
                    {status === 'Canceled' ? `(${t('messages.canceledExecution')})` : ''}
                  </Tag>
                </div>
              }
            />

            {(description || result_display || status === 'Error') && (
              <div className='mt-8px'>
                {description && (
                  <div
                    className={`text-12px text-t-secondary mb-2 ${status === 'Error' ? 'whitespace-pre-wrap break-words' : 'truncate'}`}
                  >
                    {description}
                  </div>
                )}
                {result_display && (
                  <div>
                    {/* 闂?Alert 婵犵數濮伴崹濂稿春閺嶎厽鍋嬮柡鍥ュ灪閸庢挾鈧箍鍎卞ú銊╂儗閸℃稒鐓曟繝闈涙椤忣偊鏌￠崱妯哄摵闁哄备鍓濋幏鍛村礈閹绘帗顔嶇紓鍌欑贰閸犳捇宕濋幋婵愬殨?Display full result outside Alert */}
                    {/* ToolResultDisplay 闂傚倷绀侀幉锟犲礉閺囥垹绠犳慨妞诲亾鐎规洘娲熷鍫曞箣椤撶偞娅婇梻浣告贡缁垳鏁幒妤佸剨闁割偅娲橀悡?CollapsibleContent闂傚倷鐒︾€笛呯矙閹达附鍎楅柛灞剧☉椤曢亶鏌嶉崫鍕櫣缂佲偓閸屾壕鍋撻獮鍨姎闁硅櫕鍔欐俊鍫曟濞戞帗鏂€?*/}
                    {/* ToolResultDisplay already contains CollapsibleContent internally, avoid nesting */}
                    <ToolResultDisplay content={content} />
                  </div>
                )}
                {status === 'Error' && (
                  <div className='mt-4px flex justify-end'>
                    <FeedbackButton module='conversation-session' />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default MessageToolGroup;

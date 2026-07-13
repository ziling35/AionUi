import { ipcBridge } from '@/common';
import { copyText } from '@/renderer/utils/ui/clipboard';
import { Button, Message, Spin, Tooltip } from '@arco-design/web-react';
import { Close, Copy, Download, PreviewOpen } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

type ImageAttachmentProps = {
  src: string;
  alt?: string;
  fileName?: string;
  workspace?: string;
  className?: string;
  imageClassName?: string;
};

const ACTION_BAR_STYLE: React.CSSProperties = {
  position: 'absolute',
  right: 12,
  bottom: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: 5,
  borderRadius: 12,
  background: 'rgba(15, 23, 42, 0.78)',
  border: '1px solid rgba(255, 255, 255, 0.14)',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.22)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  zIndex: 2,
};

const ACTION_BUTTON_STYLE: React.CSSProperties = {
  width: 32,
  height: 32,
  minWidth: 32,
  padding: 0,
  border: 0,
  borderRadius: 8,
  color: 'rgba(255, 255, 255, 0.92)',
  background: 'transparent',
  boxShadow: 'none',
};

const isDataUrl = (src: string): boolean => src.startsWith('data:');
const isHttpUrl = (src: string): boolean => src.startsWith('http://') || src.startsWith('https://');
const isLocalSource = (src: string): boolean => !isDataUrl(src) && !isHttpUrl(src);

const getFileName = (src: string, fileName?: string): string => {
  if (fileName) return fileName;
  if (isDataUrl(src)) return 'image.png';
  const cleanPath = src.split(/[?#]/, 1)[0];
  return cleanPath.split(/[\\/]/).pop() || 'image.png';
};

const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => await (await fetch(dataUrl)).blob();

const getRemoteImageBlob = async (src: string): Promise<Blob> => {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
  return await response.blob();
};

const writeImageToClipboard = async (blob: Blob): Promise<void> => {
  if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function' || typeof ClipboardItem === 'undefined') {
    throw new Error('Image clipboard API is unavailable');
  }

  const mimeType = blob.type || 'image/png';
  await navigator.clipboard.write([new ClipboardItem({ [mimeType]: blob })]);
};

const convertImageToPngBlob = async (blob: Blob): Promise<Blob> => {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = document.createElement('img');
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Failed to decode image'));
    });

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Failed to create image canvas');
    context.drawImage(image, 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((pngBlob) => {
        if (pngBlob) resolve(pngBlob);
        else reject(new Error('Failed to encode image'));
      }, 'image/png');
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const downloadBlob = (blob: Blob, fileName: string): void => {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
};

const ImageAttachment: React.FC<ImageAttachmentProps> = ({
  src,
  alt,
  fileName,
  workspace,
  className,
  imageClassName,
}) => {
  const { t } = useTranslation();
  const [copying, setCopying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [displaySrc, setDisplaySrc] = useState(isLocalSource(src) ? '' : src);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(isLocalSource(src));
  const resolvedFileName = useMemo(() => getFileName(src, fileName), [fileName, src]);
  const resolvedAlt = alt || resolvedFileName;

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    if (isHttpUrl(src)) {
      setDisplaySrc(src);
      setImageBlob(null);
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    const loadSource = isDataUrl(src)
      ? Promise.resolve(src)
      : ipcBridge.fs.getImageBase64.invoke({ path: src, workspace });
    void loadSource
      .then(async (dataUrl) => {
        if (!active) return;
        const blob = dataUrl ? await dataUrlToBlob(dataUrl) : null;
        if (!active) return;
        objectUrl = blob ? URL.createObjectURL(blob) : null;
        setDisplaySrc(objectUrl || '');
        setImageBlob(blob);
      })
      .catch((error) => {
        console.error('[ImageAttachment] Failed to load image:', error);
        if (active) {
          setDisplaySrc('');
          setImageBlob(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, workspace]);

  useEffect(() => {
    if (!previewVisible) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewVisible(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewVisible]);

  const handleCopy = useCallback(async () => {
    setCopying(true);
    try {
      const blob = imageBlob || (isHttpUrl(src) ? await getRemoteImageBlob(src) : await dataUrlToBlob(displaySrc));
      try {
        await writeImageToClipboard(blob);
      } catch {
        await writeImageToClipboard(await convertImageToPngBlob(blob));
      }
      Message.success(t('common.copySuccess'));
    } catch (error) {
      console.error('[ImageAttachment] Failed to copy image:', error);
      try {
        await copyText(src);
        Message.success(t('common.copySuccess'));
      } catch {
        Message.error(t('common.copyFailed'));
      }
    } finally {
      setCopying(false);
    }
  }, [displaySrc, imageBlob, src, t]);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const blob = imageBlob || (isHttpUrl(src) ? await getRemoteImageBlob(src) : await dataUrlToBlob(displaySrc));
      downloadBlob(blob, resolvedFileName);
      Message.success(t('messages.downloadSuccess'));
    } catch (error) {
      console.error('[ImageAttachment] Failed to download image:', error);
      Message.error(t('messages.downloadFailed'));
    } finally {
      setDownloading(false);
    }
  }, [displaySrc, imageBlob, resolvedFileName, src, t]);

  return (
    <div
      className={classNames(
        'group relative flex w-full max-w-720px flex-col overflow-hidden rounded-lg border bg-1 shadow-sm',
        className
      )}
      style={{ position: 'relative', width: '100%', maxWidth: 720, overflow: 'hidden', borderRadius: 12 }}
    >
      <div
        className='relative flex items-center justify-center overflow-hidden bg-2'
        style={{ position: 'relative', width: '100%', overflow: 'hidden' }}
      >
        {loading ? (
          <Spin />
        ) : displaySrc ? (
          <img
            src={displaySrc}
            alt={resolvedAlt}
            className={classNames('block h-auto w-full cursor-zoom-in', imageClassName)}
            style={{ display: 'block', width: '100%', height: 'auto', objectFit: 'contain', cursor: 'zoom-in' }}
            onClick={() => setPreviewVisible(true)}
          />
        ) : (
          <span className='text-sm text-t-secondary'>{resolvedAlt}</span>
        )}
      </div>
      {previewVisible && displaySrc
        ? createPortal(
            <div
              role='dialog'
              aria-modal='true'
              aria-label={resolvedAlt}
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 10000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 32,
                background: 'rgba(2, 6, 23, 0.88)',
                backdropFilter: 'blur(10px)',
              }}
              onClick={() => setPreviewVisible(false)}
            >
              <img
                src={displaySrc}
                alt={resolvedAlt}
                style={{ maxWidth: '94vw', maxHeight: '92vh', width: 'auto', height: 'auto', objectFit: 'contain' }}
                onClick={(event) => event.stopPropagation()}
              />
              <Button
                type='text'
                shape='circle'
                aria-label={t('common.close')}
                icon={<Close size='22' fill='currentColor' />}
                style={{
                  position: 'fixed',
                  right: 24,
                  top: 24,
                  width: 40,
                  height: 40,
                  color: '#fff',
                  background: 'rgba(255,255,255,0.12)',
                }}
                onClick={() => setPreviewVisible(false)}
              />
            </div>,
            document.body
          )
        : null}
      <div style={ACTION_BAR_STYLE}>
        <Tooltip content={t('conversation.workspace.contextMenu.preview')}>
          <Button
            aria-label={t('conversation.workspace.contextMenu.preview')}
            style={ACTION_BUTTON_STYLE}
            type='text'
            size='mini'
            disabled={!displaySrc}
            icon={<PreviewOpen theme='outline' size='16' fill='currentColor' />}
            onClick={(event) => {
              event.stopPropagation();
              setPreviewVisible(true);
            }}
          />
        </Tooltip>
        <Tooltip content={t('common.copy')}>
          <Button
            aria-label={t('common.copy')}
            style={ACTION_BUTTON_STYLE}
            type='text'
            size='mini'
            disabled={copying || !displaySrc}
            icon={copying ? <Spin size={12} /> : <Copy theme='outline' size='16' fill='currentColor' />}
            onClick={(event) => {
              event.stopPropagation();
              void handleCopy();
            }}
          />
        </Tooltip>
        <Tooltip content={t('common.download')}>
          <Button
            aria-label={t('common.download')}
            style={ACTION_BUTTON_STYLE}
            type='text'
            size='mini'
            disabled={downloading || !displaySrc}
            icon={downloading ? <Spin size={12} /> : <Download theme='outline' size='16' fill='currentColor' />}
            onClick={(event) => {
              event.stopPropagation();
              void handleDownload();
            }}
          />
        </Tooltip>
      </div>
    </div>
  );
};

export default ImageAttachment;

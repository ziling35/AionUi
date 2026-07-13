import { ipcBridge } from '@/common';
import { getCloudApiBase } from '@/renderer/api/config';
import { Button, Card, Empty, Message, Spin, Tag } from '@arco-design/web-react';
import { Download, Refresh } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';

type CloudSkill = { id: string; slug: string; name: string; description: string; version: string; content?: string };

const labels = {
  title: '\u4e91\u7aef\u6280\u80fd',
  description:
    '\u4ece LingAI \u4e91\u7aef\u83b7\u53d6\u5e76\u5b89\u88c5\u6280\u80fd\uff0c\u5b89\u88c5\u540e\u4f1a\u540c\u6b65\u5230\u4e0b\u65b9\u7684\u6211\u7684\u6280\u80fd\u3002',
  refresh: '\u5237\u65b0',
  loadFailed: '\u52a0\u8f7d\u4e91\u7aef\u6280\u80fd\u5931\u8d25',
  fetchFailed: '\u83b7\u53d6\u6280\u80fd\u5185\u5bb9\u5931\u8d25',
  installFailed: '\u5b89\u88c5\u6280\u80fd\u5931\u8d25',
  installed: '\u5df2\u5b89\u88c5',
  install: '\u5b89\u88c5',
  empty: '\u6682\u65e0\u5df2\u53d1\u5e03\u7684\u4e91\u7aef\u6280\u80fd',
};

type CloudSkillsSectionProps = { onInstalled?: () => Promise<void> | void };

const CloudSkillsSection: React.FC<CloudSkillsSectionProps> = ({ onInstalled }) => {
  const [skills, setSkills] = useState<CloudSkill[]>([]);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string>();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [response, localSkills] = await Promise.all([
        fetch(`${getCloudApiBase()}/api/skills/catalog`),
        ipcBridge.fs.listAvailableSkills.invoke(),
      ]);
      const payload = (await response.json()) as { success: boolean; data?: CloudSkill[]; message?: string };
      if (!response.ok || !payload.success) throw new Error(payload.message || labels.loadFailed);
      setSkills(payload.data || []);
      setInstalled(new Set(localSkills.map((skill) => skill.name)));
    } catch (error) {
      Message.error(error instanceof Error ? error.message : labels.loadFailed);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const install = async (skill: CloudSkill) => {
    setInstalling(skill.slug);
    try {
      const response = await fetch(`${getCloudApiBase()}/api/skills/catalog/${encodeURIComponent(skill.slug)}`);
      const payload = (await response.json()) as { success: boolean; data?: CloudSkill; message?: string };
      if (!response.ok || !payload.success || !payload.data?.content)
        throw new Error(payload.message || labels.fetchFailed);
      await ipcBridge.fs.installManagedSkill.invoke({ name: payload.data.slug, content: payload.data.content });
      setInstalled((current) => new Set(current).add(payload.data!.slug));
      await onInstalled?.();
      Message.success(`${payload.data.name} ${labels.installed}`);
    } catch (error) {
      Message.error(error instanceof Error ? error.message : labels.installFailed);
    } finally {
      setInstalling(undefined);
    }
  };

  return (
    <div className='px-[16px] md:px-[32px] py-32px bg-base rd-16px md:rd-24px shadow-sm border border-b-base'>
      <div className='mb-20px flex items-start justify-between gap-16px'>
        <div>
          <div className='text-16px md:text-18px font-bold text-t-primary'>{labels.title}</div>
          <div className='mt-5px text-13px text-t-secondary'>{labels.description}</div>
        </div>
        <Button icon={<Refresh />} onClick={() => void refresh()}>
          {labels.refresh}
        </Button>
      </div>
      {loading ? (
        <div className='flex justify-center py-40px'>
          <Spin />
        </div>
      ) : skills.length === 0 ? (
        <Empty description={labels.empty} />
      ) : (
        <div className='grid grid-cols-1 gap-12px lg:grid-cols-2'>
          {skills.map((skill) => {
            const isInstalled = installed.has(skill.slug);
            return (
              <Card key={skill.id} className='rounded-12px'>
                <div className='flex items-start justify-between gap-12px'>
                  <div className='min-w-0'>
                    <div className='flex items-center gap-8px'>
                      <span className='font-medium text-t-primary'>{skill.name}</span>
                      <Tag size='small'>v{skill.version}</Tag>
                    </div>
                    <div className='mt-6px text-13px text-t-secondary'>{skill.description}</div>
                  </div>
                  <Button
                    type={isInstalled ? 'secondary' : 'primary'}
                    icon={<Download />}
                    disabled={isInstalled}
                    loading={installing === skill.slug}
                    onClick={() => void install(skill)}
                  >
                    {isInstalled ? labels.installed : labels.install}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CloudSkillsSection;

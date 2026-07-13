import React from 'react';
import { Tooltip } from '@arco-design/web-react';
import { Magic } from '@icon-park/react';
import classNames from 'classnames';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';

type SiderSkillsEntryProps = {
  isMobile: boolean;
  isActive: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onClick: () => void;
};

const label = '\u6280\u80fd';

const SiderSkillsEntry: React.FC<SiderSkillsEntryProps> = ({
  isMobile,
  isActive,
  collapsed,
  siderTooltipProps,
  onClick,
}) => (
  <Tooltip {...siderTooltipProps} content={label} position='right'>
    <div
      className={classNames(
        collapsed
          ? 'w-full h-34px flex items-center justify-center cursor-pointer transition-colors rd-8px text-t-primary'
          : 'box-border group h-34px w-full flex items-center justify-start gap-8px pl-10px pr-8px rd-0.5rem cursor-pointer shrink-0 transition-all text-t-primary',
        isMobile && !collapsed && 'sider-action-btn-mobile',
        isActive ? 'bg-fill-3' : 'hover:bg-fill-3 active:bg-fill-4'
      )}
      onClick={onClick}
    >
      <span className={collapsed ? undefined : 'size-22px flex items-center justify-center shrink-0 text-t-primary'}>
        <Magic theme='outline' size={collapsed ? '20' : '16'} fill='currentColor' className='block leading-none' />
      </span>
      {!collapsed && <span className='collapsed-hidden text-t-primary text-14px font-[500] leading-24px'>{label}</span>}
    </div>
  </Tooltip>
);

export default SiderSkillsEntry;

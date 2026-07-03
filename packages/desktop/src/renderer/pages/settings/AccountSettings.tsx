/**
 * @license
 * Copyright 2025 LingAI (lingai.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import AccountModalContent from '@/renderer/components/settings/SettingsModal/contents/AccountModalContent';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const AccountSettings: React.FC = () => {
  return (
    <SettingsPageWrapper contentClassName='max-w-640px'>
      <AccountModalContent />
    </SettingsPageWrapper>
  );
};

export default AccountSettings;

import { httpRequest } from '@/common/adapter/httpBridge';

export type AionrsApprovalRule = {
  key: string;
  scope: string;
  category: string;
  label: string;
  created_at: number;
  updated_at: number;
};

type AionrsApprovalRulesResponse = {
  rules: AionrsApprovalRule[];
};

export type DeleteAionrsApprovalRuleResponse = {
  deleted: boolean;
  active_revoked: number;
};

export async function listAionrsApprovalRules(): Promise<AionrsApprovalRule[]> {
  const response = await httpRequest<AionrsApprovalRulesResponse>(
    'GET',
    '/api/aionrs/approval-rules',
  );
  return response.rules;
}

export async function deleteAionrsApprovalRule(
  key: string,
): Promise<DeleteAionrsApprovalRuleResponse> {
  return httpRequest<DeleteAionrsApprovalRuleResponse>('DELETE', '/api/aionrs/approval-rules', {
    key,
  });
}

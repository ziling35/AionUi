export type PermissionResponseState = 'allowed' | 'rejected';

export type PermissionResponseOption = {
  label?: string;
  value?: unknown;
  kind?: string;
  params?: Record<string, string>;
};

const REJECTION_TOKENS = ['reject', 'deny', 'cancel', 'decline', 'disallow'];
const ALLOW_TOKENS = ['allow', 'accept', 'proceed', 'approve'];

const normalize = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
};

const stateFromKind = (kind: string | undefined): PermissionResponseState | undefined => {
  if (!kind) return undefined;
  if (kind.startsWith('reject')) return 'rejected';
  if (kind.startsWith('allow')) return 'allowed';
  return undefined;
};

const stateFromText = (value: string | undefined): PermissionResponseState | undefined => {
  if (!value) return undefined;
  if (REJECTION_TOKENS.some((token) => value.includes(token)) || value === 'no' || value === 'never') {
    return 'rejected';
  }
  if (ALLOW_TOKENS.some((token) => value.includes(token)) || value === 'yes') {
    return 'allowed';
  }
  return undefined;
};

export const resolvePermissionResponseState = (
  selectedValue: unknown,
  options: PermissionResponseOption[]
): PermissionResponseState | undefined => {
  const selected = normalize(selectedValue);
  if (!selected) return undefined;

  const option = options.find((candidate) => normalize(candidate.value) === selected);
  const structuredState = stateFromKind(normalize(option?.kind) ?? normalize(option?.params?.permission_kind));
  if (structuredState) return structuredState;

  return stateFromText(selected) ?? stateFromText(normalize(option?.label));
};

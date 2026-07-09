import { describe, expect, it } from 'vitest';
import { resolvePermissionResponseState } from '@/renderer/pages/conversation/Messages/components/permissionResponseState';

describe('resolvePermissionResponseState', () => {
  it('uses structured ACP permission kind first', () => {
    expect(resolvePermissionResponseState('stop', [{ value: 'stop', label: 'Stop', kind: 'reject_once' }])).toBe(
      'rejected'
    );
    expect(
      resolvePermissionResponseState('reject-looking-id', [
        { value: 'reject-looking-id', label: 'Allow', kind: 'allow_once' },
      ])
    ).toBe('allowed');
  });

  it('uses confirmation option params when present', () => {
    expect(
      resolvePermissionResponseState('custom', [
        { value: 'custom', label: 'Custom', params: { permission_kind: 'reject_always' } },
      ])
    ).toBe('rejected');
  });

  it('falls back to selected value and label heuristics', () => {
    expect(resolvePermissionResponseState('deny', [])).toBe('rejected');
    expect(resolvePermissionResponseState('proceed_once', [])).toBe('allowed');
    expect(resolvePermissionResponseState('custom', [{ value: 'custom', label: 'No' }])).toBe('rejected');
  });

  it('returns undefined for unknown values', () => {
    expect(resolvePermissionResponseState('custom', [])).toBeUndefined();
  });
});

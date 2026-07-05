import { describe, expect, it } from 'vitest';
import { appendHashRoute, normalizeNewWindowRoute } from '@/common/utils/windowRoutes';

describe('window routes', () => {
  it('allows supported app routes for secondary windows', () => {
    expect(normalizeNewWindowRoute('/guid')).toBe('/guid');
    expect(normalizeNewWindowRoute('#/conversation/abc-123')).toBe('/conversation/abc-123');
    expect(normalizeNewWindowRoute('/team/team-1')).toBe('/team/team-1');
  });

  it('rejects unsupported or unsafe routes', () => {
    expect(normalizeNewWindowRoute('https://example.com')).toBeNull();
    expect(normalizeNewWindowRoute('/settings/model')).toBeNull();
    expect(normalizeNewWindowRoute('/conversation/a?x=1')).toBeNull();
  });

  it('appends hash route to renderer URL', () => {
    expect(appendHashRoute('http://localhost:5173/#/guid', '/conversation/abc')).toBe(
      'http://localhost:5173/#/conversation/abc'
    );
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearOpenRouteInNewWindowHandler,
  openRouteInNewWindow,
  setOpenRouteInNewWindowHandler,
} from '@process/services/routeWindowService';

describe('route window service', () => {
  afterEach(() => {
    clearOpenRouteInNewWindowHandler();
  });

  it('returns false when no opener is registered', async () => {
    await expect(openRouteInNewWindow('/guid')).resolves.toBe(false);
  });

  it('returns false for blank routes without invoking the opener', async () => {
    const handler = vi.fn(() => true);
    setOpenRouteInNewWindowHandler(handler);

    await expect(openRouteInNewWindow('   ')).resolves.toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('trims routes and returns the opener result', async () => {
    const handler = vi.fn(() => true);
    setOpenRouteInNewWindowHandler(handler);

    await expect(openRouteInNewWindow('  /conversation/abc  ')).resolves.toBe(true);
    expect(handler).toHaveBeenCalledWith('/conversation/abc');
  });
});

export function normalizeNewWindowRoute(route: string): string | null {
  const normalized = route.trim().replace(/^#/, '');
  if (!normalized.startsWith('/')) return null;
  if (normalized === '/guid' || /^\/conversation\/[^/?#]+$/.test(normalized) || /^\/team\/[^/?#]+$/.test(normalized)) {
    return normalized;
  }
  return null;
}

export function appendHashRoute(rendererUrl: string, route?: string): string {
  if (!route) return rendererUrl;
  return `${rendererUrl.replace(/#.*$/, '')}#${route}`;
}

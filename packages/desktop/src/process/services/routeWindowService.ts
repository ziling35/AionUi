/**
 * @license
 * Copyright 2025 LingAI (lingai.com)
 * SPDX-License-Identifier: Apache-2.0
 */

type OpenRouteInNewWindowHandler = (route: string) => boolean | Promise<boolean>;

let openRouteInNewWindowHandler: OpenRouteInNewWindowHandler | null = null;

export function setOpenRouteInNewWindowHandler(handler: OpenRouteInNewWindowHandler): void {
  openRouteInNewWindowHandler = handler;
}

export function clearOpenRouteInNewWindowHandler(): void {
  openRouteInNewWindowHandler = null;
}

export async function openRouteInNewWindow(route: string): Promise<boolean> {
  const normalizedRoute = route.trim();
  if (!normalizedRoute) return false;

  if (!openRouteInNewWindowHandler) {
    console.warn('[RouteWindowService] No route window opener registered.');
    return false;
  }

  return Boolean(await openRouteInNewWindowHandler(normalizedRoute));
}

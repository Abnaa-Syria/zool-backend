import type { Request } from 'express';

export type ClientPlatform = 'ios' | 'android' | 'web';

/** `X-Client-Platform: ios|android` marks a mobile client (API_CONVENTIONS §2). Anything else is web. */
export function clientPlatform(req: Request): ClientPlatform {
  const raw = req.get('x-client-platform')?.trim().toLowerCase();
  return raw === 'ios' || raw === 'android' ? raw : 'web';
}

export function isMobileClient(req: Request): boolean {
  return clientPlatform(req) !== 'web';
}

import type { NextFunction, Request, Response } from 'express';
import { runtimeSettings } from '../settings/runtime-settings';

/**
 * Keeps the runtime-settings snapshot fresh (D-SET-02). Cheap: at most one Redis GET every 5 s
 * per instance. Never blocks a request — on failure the last snapshot (or .env defaults) is used.
 */
export function settingsFreshness(_req: Request, _res: Response, next: NextFunction): void {
  runtimeSettings
    .refreshIfStale()
    .catch(() => undefined)
    .finally(() => next());
}

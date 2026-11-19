import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { AppError } from '../../shared/errors/app-error';
import { RECEIPT_MAX_BYTES } from '../../infrastructure/storage';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: RECEIPT_MAX_BYTES, files: 1 },
});

export function receiptUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single('receipt')(req, res, (err: unknown) => {
    if (err) {
      next(AppError.validation(err instanceof Error ? err.message : 'Receipt upload failed'));
      return;
    }
    next();
  });
}

export function requireReceipt(req: Request, _res: Response, next: NextFunction): void {
  if (!req.file?.buffer) {
    next(AppError.validation('receipt file is required'));
    return;
  }
  next();
}

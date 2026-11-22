import type { TopUpIntentStatus } from '@prisma/client';
import type { Request, Response } from 'express';
import { AppError } from '../../shared/errors/app-error';
import { successResponse } from '../../shared/http/success-response';
import { paymentsService } from './payments.service';

export class PaymentsController {
  async createTopUp(req: Request, res: Response): Promise<Response> {
    const auth = req.brokerAuth!;
    const { intent, created } = await paymentsService.createTopUp({
      officeId: auth.officeId,
      employeeId: auth.employeeId,
      amountMinor: req.body.amountMinor as number,
      idempotencyKey: req.body.idempotencyKey as string,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: created ? 201 : 200,
      message: created ? 'Top-up intent created successfully' : 'Top-up intent already exists',
      data: intent,
      requestId: req.requestId,
    });
  }

  async mockConfirm(req: Request, res: Response): Promise<Response> {
    const auth = req.brokerAuth!;
    const result = await paymentsService.mockConfirm({
      officeId: auth.officeId,
      employeeId: auth.employeeId,
      intentId: req.params.intentId!,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: result.replayed ? 'Top-up already confirmed' : 'Top-up confirmed successfully',
      data: { intent: result.intent, balanceMinor: result.balanceMinor },
      requestId: req.requestId,
    });
  }

  async submitEvidence(req: Request, res: Response): Promise<Response> {
    const auth = req.brokerAuth!;
    const intent = await paymentsService.submitEvidence({
      intentId: req.params.intentId!,
      officeId: auth.officeId,
      paymentReference: String(req.body.paymentReference ?? ''),
      note: req.body.note ? String(req.body.note) : undefined,
      file: { buffer: req.file!.buffer, originalName: req.file!.originalname },
      employeeId: auth.employeeId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'Top-up evidence submitted for review',
      data: intent,
      requestId: req.requestId,
    });
  }

  async webhook(req: Request, res: Response): Promise<Response> {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key] = Array.isArray(value) ? value[0] : value;
    }
    const result = await paymentsService.handleWebhook(req.params.provider!, raw, headers);
    return successResponse(res, {
      statusCode: 200,
      message: result.replayed ? 'Payment already confirmed' : 'Payment confirmed',
      data: result,
      requestId: req.requestId,
    });
  }

  async adminCreate(req: Request, res: Response): Promise<Response> {
    const amountMinor = Number(req.body.amountMinor);
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw AppError.validation('amountMinor must be a positive integer');
    }
    const intent = await paymentsService.adminCreate({
      officeId: req.params.officeId!,
      amountMinor,
      paymentReference: String(req.body.paymentReference ?? ''),
      note: req.body.note ? String(req.body.note) : undefined,
      parentIntentId: req.body.parentIntentId ? String(req.body.parentIntentId) : undefined,
      file: { buffer: req.file!.buffer, originalName: req.file!.originalname },
      adminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 201,
      message: 'Top-up submitted for review',
      data: intent,
      requestId: req.requestId,
    });
  }

  async listBroker(req: Request, res: Response): Promise<Response> {
    const result = await paymentsService.listForOffice(
      req.brokerAuth!.officeId,
      req.query as { page?: number; pageSize?: number; status?: TopUpIntentStatus },
    );
    return successResponse(res, { message: 'Top-ups retrieved', data: result.items, meta: result.meta, requestId: req.requestId });
  }

  async getBroker(req: Request, res: Response): Promise<Response> {
    const data = await paymentsService.getForOffice(req.brokerAuth!.officeId, req.params.intentId!);
    return successResponse(res, { message: 'Top-up retrieved', data, requestId: req.requestId });
  }

  async listAdmin(req: Request, res: Response): Promise<Response> {
    const result = await paymentsService.listAdmin(
      req.query as {
        page?: number;
        pageSize?: number;
        officeId?: string;
        status?: TopUpIntentStatus;
      },
    );
    return successResponse(res, {
      statusCode: 200,
      message: 'Top-up intents retrieved successfully',
      data: result.items,
      meta: result.meta,
      requestId: req.requestId,
    });
  }

  async approve(req: Request, res: Response): Promise<Response> {
    const result = await paymentsService.approve({
      intentId: req.params.intentId!,
      adminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: result.replayed ? 'Top-up already confirmed' : 'Top-up approved successfully',
      data: result,
      requestId: req.requestId,
    });
  }

  async reject(req: Request, res: Response): Promise<Response> {
    const result = await paymentsService.reject({
      intentId: req.params.intentId!,
      adminId: req.auth!.adminId,
      note: req.body?.note as string | undefined,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: result.replayed ? 'Top-up already rejected' : 'Top-up rejected',
      data: result,
      requestId: req.requestId,
    });
  }

  async getEvidence(req: Request, res: Response): Promise<void> {
    const file = await paymentsService.getEvidence(req.params.intentId!);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${file.filename}"`);
    res.setHeader('Content-Length', file.buffer.length);
    res.status(200).send(file.buffer);
  }
}

export const paymentsController = new PaymentsController();

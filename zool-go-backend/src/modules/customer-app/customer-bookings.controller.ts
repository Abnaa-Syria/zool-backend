import type { Request, Response } from 'express';
import { AppError } from '../../shared/errors/app-error';
import { successResponse } from '../../shared/http/success-response';
import { customerBookingsService, type BookingTab } from './customer-bookings.service';
import { customerCheckoutService, type CheckoutInput } from './customer-checkout.service';

function idempotencyKey(req: Request): string {
  const key = req.get('idempotency-key')?.trim() || (req.body.idempotencyKey as string | undefined);
  if (!key || key.length < 8 || key.length > 64) {
    throw AppError.validation('Idempotency-Key header (8-64 chars) is required', { field: 'Idempotency-Key' });
  }
  return key;
}

class CustomerBookingsController {
  async quote(req: Request, res: Response): Promise<Response> {
    const data = await customerCheckoutService.quote(req.customerAuth!.customerId, req.body as CheckoutInput);
    return successResponse(res, { message: 'Quote calculated', data, requestId: req.requestId });
  }

  async create(req: Request, res: Response): Promise<Response> {
    const customerId = req.customerAuth!.customerId;
    const body = req.body as CheckoutInput & { paymentMethod: 'ONLINE' | 'CASH_ON_BOARD' };
    const result = await customerCheckoutService.create(customerId, {
      holdIds: body.holdIds,
      passengers: body.passengers,
      paymentMethod: body.paymentMethod,
      ...(body.couponCode ? { couponCode: body.couponCode } : {}),
      idempotencyKey: idempotencyKey(req),
      requestId: req.requestId,
    });
    const bookings = await Promise.all(result.bookingIds.map((id) => customerBookingsService.get(customerId, id)));
    return successResponse(res, {
      statusCode: result.replayed ? 200 : 201,
      message: result.replayed ? 'Booking already created for this Idempotency-Key' : 'Booking created',
      data: { groupId: result.groupId, bookings, payment: result.payment, replayed: result.replayed },
      requestId: req.requestId,
    });
  }

  async list(req: Request, res: Response): Promise<Response> {
    const result = await customerBookingsService.list(
      req.customerAuth!.customerId,
      req.query as { tab?: BookingTab; page?: number; pageSize?: number },
    );
    return successResponse(res, { message: 'Bookings retrieved', data: result.items, meta: result.meta, requestId: req.requestId });
  }

  async get(req: Request, res: Response): Promise<Response> {
    const data = await customerBookingsService.get(req.customerAuth!.customerId, req.params.bookingId!);
    return successResponse(res, { message: 'Booking retrieved', data, requestId: req.requestId });
  }

  async ticket(req: Request, res: Response): Promise<Response> {
    const data = await customerBookingsService.getByTicket(req.customerAuth!.customerId, req.params.ticketNumber!);
    return successResponse(res, { message: 'Ticket retrieved', data, requestId: req.requestId });
  }

  async ticketPdf(req: Request, res: Response): Promise<void> {
    const { buffer, filename } = await customerBookingsService.ticketPdf(req.customerAuth!.customerId, req.params.ticketNumber!);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.status(200).send(buffer);
  }

  async payment(req: Request, res: Response): Promise<Response> {
    const data = await customerCheckoutService.getPayment(req.customerAuth!.customerId, req.params.intentId!);
    return successResponse(res, { message: 'Payment retrieved', data, requestId: req.requestId });
  }

  async mockConfirm(req: Request, res: Response): Promise<Response> {
    const data = await customerCheckoutService.mockConfirm(req.customerAuth!.customerId, req.params.intentId!);
    return successResponse(res, { message: 'Payment confirmed (mock)', data, requestId: req.requestId });
  }
}

export const customerBookingsController = new CustomerBookingsController();

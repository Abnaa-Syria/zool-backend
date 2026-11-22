import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error';
import { successResponse } from '../../shared/http/success-response';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateBroker } from '../../shared/middleware/authenticate-broker';
import { authenticateCustomer } from '../../shared/middleware/authenticate-mobile';
import { requireBrokerPermission } from '../../shared/middleware/require-broker-permission';
import { validate } from '../../shared/middleware/validate';
import { bookingsService } from '../bookings/bookings.service';
import { customerRefundsService } from '../customer-app/customer-cancellation.service';
import { customerBookingsService } from '../customer-app/customer-bookings.service';
import { bookingChangesService, type ChangeScope } from './booking-changes.service';

const params = z.object({ bookingId: z.string().min(1).max(64) });
const seatSchema = z.object({ fromSeatLabel: z.string().trim().min(1).max(8), toSeatLabel: z.string().trim().min(1).max(8) }).strict();
const optionsQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const customerSeats = z.object({ holdIds: z.array(z.string().min(1).max(64)).min(1).max(10) }).strict();
const customerChange = customerSeats.extend({ idempotencyKey: z.string().min(8).max(64).optional() }).strict();
const brokerSeats = z.object({ tripId: z.string().min(1).max(64), seatIds: z.array(z.string().min(1).max(64)).min(1).max(10) }).strict();
const brokerChange = brokerSeats.extend({ idempotencyKey: z.string().min(8).max(64) }).strict();

function idemKey(req: Request): string {
  const key = req.get('idempotency-key')?.trim() || (req.body.idempotencyKey as string | undefined);
  if (!key || key.length < 8 || key.length > 64) throw AppError.validation('Idempotency-Key header (8-64 chars) is required', { field: 'Idempotency-Key' });
  return key;
}

const customerScope = (req: Request): ChangeScope => ({ channel: 'DIRECT', customerId: req.customerAuth!.customerId });
const brokerScope = (req: Request): Extract<ChangeScope, { channel: 'BROKER' }> => {
  const a = req.brokerAuth!;
  return { channel: 'BROKER', officeId: a.officeId, employeeId: a.employeeId, seeWholeOffice: a.role === 'MANAGER' || a.permissions.includes('broker.reports.view') };
};
const brokerActor = (req: Request) => {
  const a = req.brokerAuth!;
  return { employeeId: a.employeeId, officeId: a.officeId, role: a.role, permissions: a.permissions };
};

class BookingChangesController {
  // ---- customer
  async customerSeat(req: Request, res: Response): Promise<Response> {
    await bookingChangesService.changeSeat(customerScope(req), req.params.bookingId!, { ...req.body, requestId: req.requestId });
    const data = await customerBookingsService.get(req.customerAuth!.customerId, req.params.bookingId!);
    return successResponse(res, { message: 'Seat changed', data, requestId: req.requestId });
  }

  async customerOptions(req: Request, res: Response): Promise<Response> {
    const data = await bookingChangesService.options(customerScope(req), req.params.bookingId!, req.query.date as string);
    return successResponse(res, { message: 'Change options', data, requestId: req.requestId });
  }

  async customerQuote(req: Request, res: Response): Promise<Response> {
    const data = await bookingChangesService.quote(customerScope(req), req.params.bookingId!, { holdIds: req.body.holdIds as string[] });
    return successResponse(res, { message: 'Change quote', data, requestId: req.requestId });
  }

  async customerChange(req: Request, res: Response): Promise<Response> {
    const customerId = req.customerAuth!.customerId;
    const result = await bookingChangesService.changeCustomerTrip(customerId, req.params.bookingId!, {
      holdIds: req.body.holdIds as string[],
      idempotencyKey: idemKey(req),
      requestId: req.requestId,
    });
    const refund = 'refundId' in result && result.refundId ? await customerRefundsService.process(result.refundId) : null;
    const booking = await customerBookingsService.get(customerId, result.newBookingId);
    return successResponse(res, {
      statusCode: result.replayed ? 200 : 201,
      message: result.replayed ? 'Change already applied for this Idempotency-Key' : 'Booking changed',
      data: { booking, payment: booking.payment, refund, replayed: result.replayed },
      requestId: req.requestId,
    });
  }

  // ---- broker
  async brokerSeat(req: Request, res: Response): Promise<Response> {
    await bookingChangesService.changeSeat(brokerScope(req), req.params.bookingId!, { ...req.body, requestId: req.requestId });
    const data = await bookingsService.getById(brokerActor(req), req.params.bookingId!);
    return successResponse(res, { message: 'Seat changed', data, requestId: req.requestId });
  }

  async brokerOptions(req: Request, res: Response): Promise<Response> {
    const data = await bookingChangesService.options(brokerScope(req), req.params.bookingId!, req.query.date as string);
    return successResponse(res, { message: 'Change options', data, requestId: req.requestId });
  }

  async brokerQuote(req: Request, res: Response): Promise<Response> {
    const data = await bookingChangesService.quote(brokerScope(req), req.params.bookingId!, req.body as { tripId: string; seatIds: string[] });
    return successResponse(res, { message: 'Change quote', data, requestId: req.requestId });
  }

  async brokerChange(req: Request, res: Response): Promise<Response> {
    const result = await bookingChangesService.changeBrokerTrip(brokerScope(req), req.params.bookingId!, {
      tripId: req.body.tripId as string,
      seatIds: req.body.seatIds as string[],
      idempotencyKey: req.body.idempotencyKey as string,
      requestId: req.requestId,
    });
    const booking = await bookingsService.getById(brokerActor(req), result.newBookingId);
    return successResponse(res, {
      statusCode: result.replayed ? 200 : 201,
      message: result.replayed ? 'Change already applied for this idempotencyKey' : 'Booking changed',
      data: { booking, replayed: result.replayed },
      requestId: req.requestId,
    });
  }
}

const c = new BookingChangesController();

/** Mounted at `${API_PREFIX}/customer/bookings` (D-CHG-01). */
export const customerBookingChangeRoutes = Router();
customerBookingChangeRoutes.post('/:bookingId/change-seat', authenticateCustomer, validate({ params, body: seatSchema }), asyncHandler((req, res) => c.customerSeat(req, res)));
customerBookingChangeRoutes.get('/:bookingId/change-options', authenticateCustomer, validate({ params, query: optionsQuery }), asyncHandler((req, res) => c.customerOptions(req, res)));
customerBookingChangeRoutes.post('/:bookingId/change-quote', authenticateCustomer, validate({ params, body: customerSeats }), asyncHandler((req, res) => c.customerQuote(req, res)));
customerBookingChangeRoutes.post('/:bookingId/change', authenticateCustomer, validate({ params, body: customerChange }), asyncHandler((req, res) => c.customerChange(req, res)));

/** Mounted at `${API_PREFIX}/broker/bookings` (D-CHG-01). */
export const brokerBookingChangeRoutes = Router();
const brokerGuard = [authenticateBroker, requireBrokerPermission('broker.book')];
brokerBookingChangeRoutes.post('/:bookingId/change-seat', ...brokerGuard, validate({ params, body: seatSchema }), asyncHandler((req, res) => c.brokerSeat(req, res)));
brokerBookingChangeRoutes.get('/:bookingId/change-options', ...brokerGuard, validate({ params, query: optionsQuery }), asyncHandler((req, res) => c.brokerOptions(req, res)));
brokerBookingChangeRoutes.post('/:bookingId/change-quote', ...brokerGuard, validate({ params, body: brokerSeats }), asyncHandler((req, res) => c.brokerQuote(req, res)));
brokerBookingChangeRoutes.post('/:bookingId/change', ...brokerGuard, validate({ params, body: brokerChange }), asyncHandler((req, res) => c.brokerChange(req, res)));

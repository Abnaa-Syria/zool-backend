import { csvFilename, sendCsv } from '../../shared/http/csv';
import type { AdminBookingFilters } from './bookings.service';
import type { BookingStatus } from '@prisma/client';
import type { Request, Response } from 'express';
import { successResponse } from '../../shared/http/success-response';
import { bookingsService, type BrokerActor, type PassengerInput } from './bookings.service';

function actorOf(req: Request): BrokerActor {
  const auth = req.brokerAuth!;
  return {
    employeeId: auth.employeeId,
    officeId: auth.officeId,
    role: auth.role,
    permissions: auth.permissions,
  };
}

export class BookingsController {
  async quote(req: Request, res: Response): Promise<Response> {
    const quote = await bookingsService.quote(actorOf(req), {
      tripId: req.body.tripId as string,
      seatIds: req.body.seatIds as string[],
      passengers: req.body.passengers as PassengerInput[],
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'Booking quote calculated successfully',
      data: quote,
      requestId: req.requestId,
    });
  }

  async confirm(req: Request, res: Response): Promise<Response> {
    const result = await bookingsService.confirm(actorOf(req), {
      tripId: req.body.tripId as string,
      seatIds: req.body.seatIds as string[],
      passengers: req.body.passengers as PassengerInput[],
      idempotencyKey: req.body.idempotencyKey as string,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: result.replayed ? 200 : 201,
      message: result.replayed
        ? 'Booking already confirmed for this idempotency key'
        : 'Booking confirmed successfully',
      data: { booking: result.booking, balanceAfterMinor: result.balanceAfterMinor },
      requestId: req.requestId,
    });
  }

  async list(req: Request, res: Response): Promise<Response> {
    const result = await bookingsService.list(
      actorOf(req),
      req.query as {
        page?: number;
        pageSize?: number;
        employeeId?: string;
        companyId?: string;
        status?: BookingStatus;
        from?: string;
        to?: string;
      },
    );
    return successResponse(res, {
      statusCode: 200,
      message: 'Bookings retrieved successfully',
      data: result.items,
      meta: result.meta,
      requestId: req.requestId,
    });
  }

  async get(req: Request, res: Response): Promise<Response> {
    const booking = await bookingsService.getById(actorOf(req), req.params.id!);
    return successResponse(res, {
      statusCode: 200,
      message: 'Booking retrieved successfully',
      data: booking,
      requestId: req.requestId,
    });
  }

  async cancel(req: Request, res: Response): Promise<Response> {
    const result = await bookingsService.cancel(actorOf(req), {
      bookingId: req.params.id!,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'Booking cancelled successfully',
      data: result,
      requestId: req.requestId,
    });
  }

  async dispatch(req: Request, res: Response): Promise<Response> {
    const result = await bookingsService.dispatch(actorOf(req), {
      bookingId: req.params.id!,
      channel: (req.body as { channel: 'download' | 'whatsapp' | 'sms' }).channel,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: 'Booking tickets ready for dispatch',
      data: result,
      requestId: req.requestId,
    });
  }

  async getTicketPdf(req: Request, res: Response): Promise<void> {
    const { buffer, filename } = await bookingsService.getTicketPdf(actorOf(req), {
      bookingId: req.params.id!,
      ticketNumber: req.params.ticketNumber!,
    });
    this.sendPdf(res, buffer, filename);
  }

  async getAdminTicketPdf(req: Request, res: Response): Promise<void> {
    const { buffer, filename } = await bookingsService.getAdminTicketPdf({
      bookingId: req.params.id!,
      ticketNumber: req.params.ticketNumber!,
    });
    this.sendPdf(res, buffer, filename);
  }

  private sendPdf(res: Response, buffer: Buffer, filename: string): void {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.status(200).send(buffer);
  }

  async exportAdminCsv(req: Request, res: Response): Promise<void> {
    const csv = await bookingsService.exportAdminCsv(req.query as AdminBookingFilters, {
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    sendCsv(res, csv, csvFilename('bookings'));
  }

  async listAdmin(req: Request, res: Response): Promise<Response> {
    const result = await bookingsService.listAdmin(
      req.query as {
        page?: number;
        pageSize?: number;
        officeId?: string;
        companyId?: string;
        employeeId?: string;
        status?: BookingStatus;
        from?: string;
        to?: string;
        q?: string;
      },
    );
    return successResponse(res, {
      statusCode: 200,
      message: 'Bookings retrieved successfully',
      data: result.items,
      meta: result.meta,
      requestId: req.requestId,
    });
  }

  async getAdmin(req: Request, res: Response): Promise<Response> {
    const booking = await bookingsService.getAdminById(req.params.id!);
    return successResponse(res, {
      statusCode: 200,
      message: 'Booking retrieved successfully',
      data: booking,
      requestId: req.requestId,
    });
  }

  async cancelAdmin(req: Request, res: Response): Promise<Response> {
    const result = await bookingsService.cancelByAdmin({
      bookingId: req.params.id!,
      reason: req.body.reason as string,
      actorAdminId: req.auth!.adminId,
      requestId: req.requestId,
    });
    return successResponse(res, {
      statusCode: 200,
      message: result.replayed ? 'Booking already cancelled' : 'Booking cancelled successfully',
      data: result,
      requestId: req.requestId,
    });
  }
}

export const bookingsController = new BookingsController();

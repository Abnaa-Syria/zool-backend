import { newBookingRef } from '../../shared/utils/references';
import { CSV_MAX_ROWS, toCsv } from '../../shared/http/csv';
import {
  BookingChannel,
  BookingGroupType,
  BookingLeg,
  BookingStatus,
  CommissionAccrualStatus,
  Prisma,
  TicketDispatchChannel,
  TicketDispatchStatus,
  TicketStatus,
  TripSeatStatus,
  WalletLedgerType,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { env } from '../../config/env';
import { ticketQrPayload } from '../../shared/security/ticket-qr';
import { assertNotInMaintenance } from '../../shared/settings/runtime-settings';
import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import {
  compareSeatLabels,
  computeCommission,
  decimalToNumber,
} from '../../shared/utils/money';
import { resolveOfficePolicy } from '../../shared/utils/office-policy';
import { normalizePhone } from '../../shared/utils/phone';
import { paginationMeta, parsePagination } from '../../shared/utils/pagination';
import { officeDayBounds, parseDateBound } from '../../shared/utils/timezone';
import { auditService } from '../audit/audit.service';
import { customerCancellationService } from '../customer-app/customer-cancellation.service';
import { catalogRepository } from '../catalog/catalog.repository';
import { catalogService } from '../catalog/catalog.service';
import { CatalogErrors } from '../catalog/catalog.errors';
import { commissionsRepository } from '../commissions/commissions.repository';
import { WalletErrors } from '../wallets/wallets.errors';
import { walletsRepository } from '../wallets/wallets.repository';
import { walletsService } from '../wallets/wallets.service';
import { BookingErrors } from './bookings.errors';
import { toBookingDto, type BookingDto } from './bookings.dto';
import { bookingsRepository } from './bookings.repository';
import { pdfTicketRenderer } from './pdf-ticket-renderer';
import type { TicketDocument, TicketDispatchResult } from './ticket-document';

const CHANNEL_TO_ENUM: Record<'download', TicketDispatchChannel> = {
  download: TicketDispatchChannel.DOWNLOAD,
};

function assertSdg(currency: string): void {
  if (currency !== 'SDG') {
    throw new AppError({
      message: 'Only SDG wallets are supported in M1',
      statusCode: 409,
      code: ErrorCodes.UNSUPPORTED_CURRENCY,
      details: { currency },
    });
  }
}

export interface BrokerActor {
  employeeId: string;
  officeId: string;
  role: 'MANAGER' | 'CLERK';
  permissions: string[];
}

export interface PassengerInput {
  fullName: string;
  phone: string;
  idNumber?: string;
  /** Required for women-only seats */
  gender?: 'MALE' | 'FEMALE';
}

/** D-RT-01: the return leg goes back between the same cities after the outbound arrives. */
function assertRoundTrip(
  out: { originStationId: string | null; destinationStationId: string | null; origin: string; destination: string; departureAt: Date; arrivalAt: Date | null },
  back: { originStationId: string | null; destinationStationId: string | null; origin: string; destination: string; departureAt: Date },
): void {
  const mirrored = out.origin === back.destination && out.destination === back.origin;
  if (!mirrored || back.departureAt.getTime() < (out.arrivalAt ?? out.departureAt).getTime()) {
    throw new AppError({
      statusCode: 422,
      code: ErrorCodes.ROUND_TRIP_INVALID,
      message: 'The return trip must go back between the same cities after the outbound trip arrives',
    });
  }
}

const ISOLATION = Prisma.TransactionIsolationLevel.ReadCommitted;

function canSeeWholeOffice(actor: BrokerActor): boolean {
  return actor.role === 'MANAGER' || actor.permissions.includes('broker.reports.view');
}

function normalizePassengerPhone(phone: string): string {
  try {
    return normalizePhone(phone);
  } catch {
    return phone.trim();
  }
}

function ticketNumber(now = new Date()): string {
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `ZG-${ymd}-${randomBytes(5).toString('hex').toUpperCase()}`;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function assertLines(seatIds: string[], passengers: PassengerInput[]): void {
  if (new Set(seatIds).size !== seatIds.length) {
    throw AppError.validation('seatIds must be unique', { field: 'seatIds' });
  }
  if (passengers.length !== seatIds.length) {
    throw BookingErrors.passengerSeatMismatch();
  }
}


/** `from`/`to` list filters; date-only values are Sudan calendar days (API_CONVENTIONS §6). */
function confirmedAtFilter(query: { from?: string; to?: string }): Prisma.DateTimeFilter {
  const tz = env().PLATFORM_TIMEZONE;
  const filter: Prisma.DateTimeFilter = {};
  if (query.from) filter.gte = parseDateBound(query.from, 'from', tz).date;
  if (query.to) {
    const to = parseDateBound(query.to, 'to', tz);
    if (to.exclusive) filter.lt = to.date;
    else filter.lte = to.date;
  }
  return filter;
}


export type AdminBookingFilters = {
  officeId?: string;
  customerId?: string;
  companyId?: string;
  employeeId?: string;
  status?: BookingStatus;
  from?: string;
  to?: string;
  q?: string;
};

/** Shared by the admin list and its CSV export so both apply identical filters. */
export function adminBookingsWhere(query: AdminBookingFilters): Prisma.BookingWhereInput {
  const confirmedAt = confirmedAtFilter(query);
  const q = query.q?.trim();
  return {
    ...(query.officeId ? { officeId: query.officeId } : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    ...(query.companyId ? { trip: { companyId: query.companyId } } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(Object.keys(confirmedAt).length > 0 ? { confirmedAt } : {}),
    ...(q
      ? {
          OR: [
            { id: { contains: q } },
            { bookingRef: { contains: q } },
            { tickets: { some: { ticketNumber: { contains: q } } } },
            { passengers: { some: { phone: { contains: q } } } },
            { passengers: { some: { fullName: { contains: q } } } },
          ],
        }
      : {}),
  };
}

export class BookingsService {
  // ---------------------------------------------------------------- quote

  async quote(
    actor: BrokerActor,
    input: { tripId: string; seatIds: string[]; passengers: PassengerInput[]; returnTrip?: { tripId: string; seatIds: string[] } },
  ): Promise<Record<string, unknown> & { totalAmountMinor: number; expectedCommissionMinor: number; walletBalanceMinor: number }> {
    if (input.returnTrip) {
      // D-RT-01: price both legs; the wallet must cover the sum.
      const { returnTrip, ...outbound } = input;
      const out = await this.quote(actor, outbound);
      const back = await this.quote(actor, { tripId: returnTrip.tripId, seatIds: returnTrip.seatIds, passengers: input.passengers });
      const [t1, t2] = await Promise.all([
        catalogRepository.findTripForBroker(input.tripId, actor.officeId),
        catalogRepository.findTripForBroker(returnTrip.tripId, actor.officeId),
      ]);
      assertRoundTrip(t1!, t2!);
      const total = out.totalAmountMinor + back.totalAmountMinor;
      const ex = out.exposure as { ceiling: number; usedToday: number };
      const seatsBoth = (out.seatCount as number) + (back.seatCount as number);
      return {
        ...out,
        exposure: { ...ex, remaining: Math.max(0, ex.ceiling - ex.usedToday), withinCeiling: ex.usedToday + seatsBoth <= ex.ceiling },
        returnLeg: back,
        combinedTotalMinor: total,
        combinedCommissionMinor: out.expectedCommissionMinor + back.expectedCommissionMinor,
        balanceAfterMinor: out.walletBalanceMinor - total,
        sufficientBalance: out.walletBalanceMinor >= total,
      };
    }
    assertLines(input.seatIds, input.passengers);

    await catalogService.releaseExpiredHolds(input.tripId);

    const trip = await catalogRepository.findTripForBroker(input.tripId, actor.officeId);
    if (!trip) throw CatalogErrors.tripNotFound();
    if (!trip.isActive || trip.departureAt.getTime() <= Date.now()) {
      throw CatalogErrors.tripNotBookable();
    }

    const [assignment, wallet, office] = await Promise.all([
      catalogRepository.findAssignment(actor.officeId, trip.companyId),
      walletsRepository.findByOfficeId(actor.officeId),
      bookingsRepository.findOffice(actor.officeId),
    ]);
    if (!assignment) throw CatalogErrors.tripNotFound();
    if (!wallet || !office) throw WalletErrors.walletNotFound();
    assertSdg(wallet.currency);

    const seats = await catalogRepository.listSeatsWithHolds(trip.id);
    const selected = seats.filter((s) => input.seatIds.includes(s.id));
    if (selected.length !== input.seatIds.length) throw CatalogErrors.seatNotFound();

    const unavailable = selected.filter(
      (s) =>
        !(
          s.status === TripSeatStatus.FREE ||
          (s.status === TripSeatStatus.HELD && s.hold?.employeeId === actor.employeeId)
        ),
    );
    if (unavailable.length > 0) {
      throw CatalogErrors.seatUnavailable({ unavailableSeatIds: unavailable.map((s) => s.id) });
    }

    input.seatIds.forEach((seatId, i) => {
      const seat = selected.find((s) => s.id === seatId)!;
      if (seat.isWomenOnly && input.passengers[i]?.gender !== 'FEMALE') {
        throw new AppError({
          statusCode: 422,
          code: ErrorCodes.WOMEN_ONLY_SEAT,
          message: `Seat ${seat.seatLabel} is for women only`,
          details: { tripId: trip.id, seatLabel: seat.seatLabel, passengerIndex: i },
        });
      }
    });

    const seatCount = selected.length;
    const totalAmount = trip.basePrice * seatCount;
    const commissionPercent = decimalToNumber(assignment.commissionPercent);
    const expectedCommission = computeCommission(totalAmount, commissionPercent);

    const policy = resolveOfficePolicy(office);
    const { from, to } = officeDayBounds(new Date(), policy.timeZone);
    const usedToday = await bookingsRepository.countConfirmedTickets(actor.officeId, from, to);
    const ceiling = policy.exposureCeiling;

    const heldByMe = selected.every(
      (s) => s.status === TripSeatStatus.HELD && s.hold?.employeeId === actor.employeeId,
    );

    return {
      tripId: trip.id,
      seats: selected
        .sort((a, b) => compareSeatLabels(a.seatLabel, b.seatLabel))
        .map((s) => ({ id: s.id, label: s.seatLabel })),
      seatCount,
      unitPriceMinor: trip.basePrice,
      totalAmountMinor: totalAmount,
      commissionPercent,
      expectedCommissionMinor: expectedCommission,
      walletBalanceMinor: wallet.balance,
      balanceAfterMinor: wallet.balance - totalAmount,
      sufficientBalance: wallet.balance >= totalAmount,
      heldByMe,
      exposure: {
        ceiling,
        usedToday,
        remaining: Math.max(0, ceiling - usedToday),
        withinCeiling: usedToday + seatCount <= ceiling,
      },
    };
  }

  // -------------------------------------------------------------- confirm

  async confirm(
    actor: BrokerActor,
    input: {
      tripId: string;
      seatIds: string[];
      passengers: PassengerInput[];
      /** D-RT-01: return leg with the same passengers (passenger i in returnTrip.seatIds[i]) */
      returnTrip?: { tripId: string; seatIds: string[] };
      idempotencyKey: string;
      requestId?: string;
    },
  ) {
    assertLines(input.seatIds, input.passengers);
    if (input.returnTrip) assertLines(input.returnTrip.seatIds, input.passengers);
    assertNotInMaintenance();

    const ledgerKey = `booking:${actor.officeId}:${input.idempotencyKey}`;

    const replay = await this.findReplay(ledgerKey, actor.officeId, input.tripId);
    if (replay) return { ...replay, replayed: true };

    const wallet = await walletsRepository.findByOfficeId(actor.officeId);
    if (!wallet) throw WalletErrors.walletNotFound();
    assertSdg(wallet.currency);

    // Expired holds are released (and committed) before the atomic section.
    await catalogService.releaseExpiredHolds(input.tripId);
    if (input.returnTrip) await catalogService.releaseExpiredHolds(input.returnTrip.tripId);

    const legs: Array<{ tripId: string; seatIds: string[]; leg: BookingLeg | null; key: string }> = input.returnTrip
      ? [
          { tripId: input.tripId, seatIds: input.seatIds, leg: BookingLeg.OUTBOUND, key: ledgerKey },
          { tripId: input.returnTrip.tripId, seatIds: input.returnTrip.seatIds, leg: BookingLeg.RETURN, key: `${ledgerKey}:return` },
        ]
      : [{ tripId: input.tripId, seatIds: input.seatIds, leg: null, key: ledgerKey }];

    let result: { bookingIds: string[]; balanceAfter: number };
    try {
      result = await getPrisma().$transaction(
        async (tx) => {
          // Serialize all money/capacity decisions for this office.
          await walletsService.lock(wallet.id, tx);

          const office = await bookingsRepository.findOffice(actor.officeId, tx);
          if (!office) throw WalletErrors.walletNotFound();
          const policy = resolveOfficePolicy(office);
          const now = new Date();

          // Exposure ceiling: confirmed tickets issued today by this office (both legs count).
          const { from, to } = officeDayBounds(now, policy.timeZone);
          const usedToday = await bookingsRepository.countConfirmedTickets(actor.officeId, from, to, tx);
          const requested = legs.reduce((n, l) => n + l.seatIds.length, 0);
          if (usedToday + requested > policy.exposureCeiling) {
            throw BookingErrors.exposureCeilingExceeded({ ceiling: policy.exposureCeiling, usedToday, requested });
          }

          const trips = [];
          for (const l of legs) {
            const trip = await catalogRepository.findTripForBroker(l.tripId, actor.officeId, tx);
            if (!trip) throw CatalogErrors.tripNotFound();
            if (!trip.isActive || trip.departureAt.getTime() <= Date.now()) throw CatalogErrors.tripNotBookable();
            trips.push(trip);
          }
          if (trips.length === 2) assertRoundTrip(trips[0]!, trips[1]!);

          const group =
            legs.length === 2
              ? await tx.bookingGroup.create({ data: { type: BookingGroupType.ROUND_TRIP, channel: BookingChannel.BROKER, officeId: actor.officeId } })
              : null;

          const bookingIds: string[] = [];
          let balanceAfter = wallet.balance;
          for (const [li, l] of legs.entries()) {
            const trip = trips[li]!;
            const assignment = await catalogRepository.findAssignment(actor.officeId, trip.companyId, tx);
            if (!assignment) throw CatalogErrors.tripNotFound();

            const seats = await bookingsRepository.seatsWithHolds(trip.id, l.seatIds, tx);
            if (seats.length !== l.seatIds.length) throw CatalogErrors.seatNotFound();

            const badSeats: string[] = [];
            let seatTaken = false;
            for (const seat of seats) {
              const ownedHold =
                seat.status === TripSeatStatus.HELD &&
                seat.hold !== null &&
                seat.hold.employeeId === actor.employeeId &&
                seat.hold.officeId === actor.officeId &&
                seat.hold.expiresAt.getTime() > now.getTime();
              if (!ownedHold) {
                badSeats.push(seat.id);
                if (seat.status === TripSeatStatus.SOLD || seat.status === TripSeatStatus.HELD) seatTaken = true;
              }
            }
            if (badSeats.length > 0) {
              if (seatTaken) throw CatalogErrors.seatUnavailable({ unavailableSeatIds: badSeats });
              throw BookingErrors.holdRequired({ seatIds: badSeats });
            }

            // Women-only seats need a passenger declared FEMALE.
            const seatById = new Map(seats.map((s) => [s.id, s]));
            l.seatIds.forEach((seatId, i) => {
              const seat = seatById.get(seatId)!;
              if (seat.isWomenOnly && input.passengers[i]!.gender !== 'FEMALE') {
                throw new AppError({
                  statusCode: 422,
                  code: ErrorCodes.WOMEN_ONLY_SEAT,
                  message: `Seat ${seat.seatLabel} is for women only`,
                  details: { tripId: trip.id, seatLabel: seat.seatLabel, passengerIndex: i },
                });
              }
            });

            const totalAmount = trip.basePrice * seats.length;
            const commissionAmount = computeCommission(totalAmount, decimalToNumber(assignment.commissionPercent));

            const booking = await bookingsRepository.createBooking(
              {
                officeId: actor.officeId,
                employeeId: actor.employeeId,
                tripId: trip.id,
                totalAmount,
                commissionAmount,
                confirmedAt: now,
                bookingRef: newBookingRef(env().PLATFORM_TIMEZONE, now),
                ...(group ? { groupId: group.id, leg: l.leg } : {}),
              },
              tx,
            );

            const debit = await walletsService.debit(tx, {
              walletId: wallet.id,
              amount: totalAmount,
              type: WalletLedgerType.DEBIT_BOOKING,
              idempotencyKey: l.key,
              referenceType: 'booking',
              referenceId: booking.id,
            });
            if (debit.replayed) throw BookingErrors.idempotencyInFlight();
            balanceAfter = debit.entry.balanceAfter;

            // Pair passengers with seats in the order the client supplied the seatIds.
            for (const [index, seatId] of l.seatIds.entries()) {
              const seat = seatById.get(seatId);
              const passenger = input.passengers[index];
              if (!seat || !passenger) throw BookingErrors.passengerSeatMismatch();
              const createdPassenger = await bookingsRepository.createPassenger(
                {
                  bookingId: booking.id,
                  fullName: passenger.fullName,
                  phone: normalizePassengerPhone(passenger.phone),
                  ...(passenger.idNumber ? { idNumber: passenger.idNumber } : {}),
                  ...(passenger.gender ? { gender: passenger.gender } : {}),
                },
                tx,
              );
              await bookingsRepository.createTicket(
                { bookingId: booking.id, tripSeatId: seat.id, passengerId: createdPassenger.id, ticketNumber: ticketNumber(now) },
                tx,
              );
            }

            const sold = await bookingsRepository.markSeatsSold(l.seatIds, tx);
            if (sold !== l.seatIds.length) throw CatalogErrors.seatUnavailable();
            await bookingsRepository.deleteHoldsForSeats(l.seatIds, tx);

            await commissionsRepository.createAccrual({ bookingId: booking.id, officeId: actor.officeId, amount: commissionAmount }, tx);

            await auditService.record(
              {
                action: 'booking.confirmed',
                resourceType: 'booking',
                resourceId: booking.id,
                requestId: input.requestId,
                metadata: {
                  officeId: actor.officeId,
                  employeeId: actor.employeeId,
                  tripId: trip.id,
                  leg: l.leg,
                  groupId: group?.id ?? null,
                  seatLabels: [...seats].sort((a, b) => compareSeatLabels(a.seatLabel, b.seatLabel)).map((s) => s.seatLabel),
                  totalAmount,
                  commissionAmount,
                  balanceAfter,
                },
              },
              tx,
            );
            bookingIds.push(booking.id);
          }

          return { bookingIds, balanceAfter };
        },
        { isolationLevel: ISOLATION, maxWait: 10_000, timeout: 20_000 },
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.findReplay(ledgerKey, actor.officeId, input.tripId);
        if (existing) return { ...existing, replayed: true };
      }
      throw error;
    }

    const booking = await bookingsRepository.findById(result.bookingIds[0]!, actor.officeId);
    if (!booking) throw BookingErrors.notFound();
    const returnBooking = result.bookingIds[1] ? await bookingsRepository.findById(result.bookingIds[1], actor.officeId) : null;
    return {
      booking: toBookingDto(booking),
      returnBooking: returnBooking ? toBookingDto(returnBooking) : null,
      balanceAfterMinor: result.balanceAfter,
      replayed: false,
    };
  }

  private async findReplay(ledgerKey: string, officeId: string, tripId: string) {
    const entry = await walletsRepository.findLedgerByKey(ledgerKey);
    if (!entry || entry.referenceType !== 'booking' || !entry.referenceId) return null;
    const booking = await bookingsRepository.findById(entry.referenceId, officeId);
    if (!booking) return null;
    if (booking.tripId !== tripId) {
      throw AppError.conflict('Idempotency key was already used with a different request');
    }
    const returnLeg = await walletsRepository.findLedgerByKey(`${ledgerKey}:return`);
    const returnBooking = returnLeg?.referenceId ? await bookingsRepository.findById(returnLeg.referenceId, officeId) : null;
    return {
      booking: toBookingDto(booking),
      returnBooking: returnBooking ? toBookingDto(returnBooking) : null,
      balanceAfterMinor: returnLeg?.balanceAfter ?? entry.balanceAfter,
    };
  }

  // ----------------------------------------------------------------- read

  async list(
    actor: BrokerActor,
    query: {
      page?: number;
      pageSize?: number;
      employeeId?: string;
      companyId?: string;
      status?: BookingStatus;
      tab?: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
      q?: string;
      from?: string;
      to?: string;
    },
  ) {
    const { page, pageSize, skip, take } = parsePagination(query);
    const q = query.q?.trim();
    const tabWhere: Prisma.BookingWhereInput =
      query.tab === 'ACTIVE'
        ? { status: BookingStatus.CONFIRMED, trip: { status: { in: ['SCHEDULED', 'BOARDING', 'IN_PROGRESS'] } } }
        : query.tab === 'COMPLETED'
          ? { status: BookingStatus.CONFIRMED, trip: { status: 'COMPLETED' } }
          : query.tab === 'CANCELLED'
            ? { OR: [{ status: { in: [BookingStatus.CANCELLED, BookingStatus.CHANGED] } }, { trip: { status: 'CANCELLED' } }] }
            : {};

    const employeeFilter = canSeeWholeOffice(actor) ? query.employeeId : actor.employeeId;

    const confirmedAt = confirmedAtFilter(query);

    const where: Prisma.BookingWhereInput = {
      officeId: actor.officeId,
      ...(employeeFilter ? { employeeId: employeeFilter } : {}),
      ...(query.companyId ? { trip: { companyId: query.companyId } } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(Object.keys(confirmedAt).length > 0 ? { confirmedAt } : {}),
      AND: [
        tabWhere,
        q
          ? {
              OR: [
                { bookingRef: { contains: q } },
                { tickets: { some: { ticketNumber: { contains: q } } } },
                { passengers: { some: { fullName: { contains: q } } } },
                { passengers: { some: { phone: { contains: q } } } },
              ],
            }
          : {},
      ],
    };

    const { items, total } = await bookingsRepository.list({ where, skip, take });
    return { items: items.map(toBookingDto), meta: paginationMeta(page, pageSize, total) };
  }

  async getById(actor: BrokerActor, bookingId: string) {
    const booking = await bookingsRepository.findById(bookingId, actor.officeId);
    if (!booking) throw BookingErrors.notFound();
    if (!canSeeWholeOffice(actor) && booking.employeeId !== actor.employeeId) {
      throw BookingErrors.notFound();
    }
    return toBookingDto(booking);
  }

  async listAdmin(query: {
    page?: number;
    pageSize?: number;
    officeId?: string;
    companyId?: string;
    employeeId?: string;
    status?: BookingStatus;
    from?: string;
    to?: string;
    q?: string;
  }) {
    const { page, pageSize, skip, take } = parsePagination(query);
    const where = adminBookingsWhere(query);
    const { items, total } = await bookingsRepository.list({ where, skip, take });
    return { items: items.map(toBookingDto), meta: paginationMeta(page, pageSize, total) };
  }

  /** REQ-ADM-14: same filters as listAdmin; synchronous, capped at CSV_MAX_ROWS. */
  async exportAdminCsv(query: AdminBookingFilters, actor: { actorAdminId: string; requestId?: string }) {
    const where = adminBookingsWhere(query);
    const total = await bookingsRepository.count(where);
    if (total > CSV_MAX_ROWS) {
      throw new AppError({
        statusCode: 422,
        code: ErrorCodes.RANGE_TOO_LARGE,
        message: `Export is limited to ${CSV_MAX_ROWS} rows; narrow the filters`,
        details: { total, max: CSV_MAX_ROWS },
      });
    }
    const rows = await bookingsRepository.listForExport(where, CSV_MAX_ROWS);
    await auditService.record({
      actorAdminId: actor.actorAdminId,
      action: 'bookings.exported',
      resourceType: 'booking',
      requestId: actor.requestId,
      metadata: { filters: query, rows: rows.length },
    });
    return toCsv(
      [
        'bookingId', 'bookingRef', 'channel', 'status', 'paymentMethod', 'paymentStatus', 'officeCode', 'officeName',
        'employee', 'carrier', 'tripNumber', 'origin', 'destination', 'departureAt', 'tickets',
        'totalAmountMinor', 'commissionAmountMinor', 'currency', 'confirmedAt', 'cancelledAt', 'createdAt',
      ],
      rows.map((b) => [
        b.id, b.bookingRef, b.channel, b.status, b.paymentMethod, b.paymentStatus, b.office?.code, b.office?.name,
        b.employee?.displayName, b.trip.company.name, b.trip.tripNumber, b.trip.origin, b.trip.destination,
        b.trip.departureAt, b._count.tickets, b.totalAmount, b.commissionAmount, 'SDG', b.confirmedAt, b.cancelledAt,
        b.createdAt,
      ]),
    );
  }

  async getAdminById(bookingId: string) {
    const booking = await bookingsRepository.findByIdUnscoped(bookingId);
    if (!booking) throw BookingErrors.notFound();
    return toBookingDto(booking);
  }

  // --------------------------------------------------------------- cancel

  async cancel(actor: BrokerActor, input: { bookingId: string; requestId?: string }) {
    const booking = await bookingsRepository.findById(input.bookingId, actor.officeId);
    if (!booking) throw BookingErrors.notFound();
    if (booking.employeeId !== actor.employeeId && actor.role !== 'MANAGER') {
      throw AppError.forbidden('Only the booking owner or an office manager can cancel it');
    }
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw BookingErrors.notCancellable(booking.status);
    }

    const wallet = await walletsRepository.findByOfficeId(actor.officeId);
    if (!wallet) throw WalletErrors.walletNotFound();

    const outcome = await getPrisma().$transaction(
      async (tx) => {
        await walletsService.lock(wallet.id, tx);

        const cancelled = await bookingsRepository.cancelBooking(booking.id, tx);
        if (cancelled === 0) {
          throw BookingErrors.notCancellable(BookingStatus.CANCELLED);
        }

        await bookingsRepository.cancelTickets(booking.id, tx);
        const seatIds = booking.tickets
          .map((t) => t.tripSeatId)
          .filter((id): id is string => id !== null);
        await bookingsRepository.freeSeats(seatIds, tx);

        const refund = await walletsService.credit(tx, {
          walletId: wallet.id,
          amount: booking.totalAmount,
          type: WalletLedgerType.CREDIT_REFUND,
          idempotencyKey: `refund:${booking.id}`,
          referenceType: 'booking',
          referenceId: booking.id,
        });

        const accrual = await commissionsRepository.findAccrualByBooking(booking.id, tx);
        const previousCommissionStatus = accrual?.status ?? null;
        await commissionsRepository.markClawedBack(booking.id, tx);

        await auditService.record(
          {
            action: 'booking.cancelled',
            resourceType: 'booking',
            resourceId: booking.id,
            requestId: input.requestId,
            metadata: {
              officeId: actor.officeId,
              employeeId: actor.employeeId,
              refundedAmount: booking.totalAmount,
              commissionClawedBack: accrual?.amount ?? 0,
              previousCommissionStatus,
              clawedBackAfterSettlement:
                previousCommissionStatus === CommissionAccrualStatus.SETTLED,
              balanceAfter: refund.entry.balanceAfter,
            },
          },
          tx,
        );

        return { balanceAfter: refund.entry.balanceAfter, clawedBack: accrual?.amount ?? 0 };
      },
      { isolationLevel: ISOLATION, maxWait: 10_000, timeout: 20_000 },
    );

    const updated = await bookingsRepository.findById(booking.id, actor.officeId);
    if (!updated) throw BookingErrors.notFound();
    return {
      booking: toBookingDto(updated),
      refundedAmountMinor: booking.totalAmount,
      commissionClawedBackMinor: outcome.clawedBack,
      balanceAfterMinor: outcome.balanceAfter,
    };
  }

  async cancelByAdmin(input: {
    bookingId: string;
    reason: string;
    actorAdminId: string;
    /** Trip cancelled by the carrier/admin (D-SUS-01): customer refunds are labelled CARRIER_CANCEL */
    carrierCancelled?: boolean;
    requestId?: string;
  }) {
    const booking = await bookingsRepository.findByIdUnscoped(input.bookingId);
    if (!booking) throw BookingErrors.notFound();
    if (booking.channel === BookingChannel.DIRECT) {
      // Customer app booking: refund to the original payment method, never a fee (admin action).
      const result = await customerCancellationService.cancel({
        bookingId: booking.id,
        actor: { type: 'ADMIN', adminId: input.actorAdminId },
        reason: input.reason,
        carrierCancelled: input.carrierCancelled ?? false,
        ...(input.requestId ? { requestId: input.requestId } : {}),
      });
      const updated = await bookingsRepository.findByIdUnscoped(booking.id);
      return {
        booking: toBookingDto(updated!),
        refundedAmountMinor: result.refund?.amountMinor ?? 0,
        commissionClawedBackMinor: 0,
        balanceAfterMinor: null,
        refund: result.refund,
        replayed: result.replayed,
      };
    }
    if (!booking.officeId) throw BookingErrors.brokerChannelRequired(booking.id);

    const wallet = await walletsRepository.findByOfficeId(booking.officeId);
    if (!wallet) throw WalletErrors.walletNotFound();

    if (booking.status === BookingStatus.CANCELLED) {
      const existing = await walletsRepository.findLedgerByKey(`refund:${booking.id}`);
      return {
        booking: toBookingDto(booking),
        refundedAmountMinor: booking.totalAmount,
        commissionClawedBackMinor: booking.commissionAmount,
        balanceAfterMinor: existing?.balanceAfter ?? wallet.balance,
        replayed: true,
      };
    }
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw BookingErrors.notCancellable(booking.status);
    }

    const outcome = await getPrisma().$transaction(
      async (tx) => {
        await walletsService.lock(wallet.id, tx);

        const cancelled = await bookingsRepository.cancelBooking(booking.id, tx, input.reason);
        if (cancelled === 0) {
          const again = await bookingsRepository.findByIdUnscoped(booking.id, tx);
          if (again?.status === BookingStatus.CANCELLED) {
            const refund = await walletsRepository.findLedgerByKey(`refund:${booking.id}`, tx);
            return {
              balanceAfter: refund?.balanceAfter ?? wallet.balance,
              clawedBack: again.commissionAmount,
              replayed: true,
            };
          }
          throw BookingErrors.notCancellable(BookingStatus.CANCELLED);
        }

        await bookingsRepository.cancelTickets(booking.id, tx);
        const seatIds = booking.tickets
          .map((t) => t.tripSeatId)
          .filter((id): id is string => id !== null);
        await bookingsRepository.freeSeats(seatIds, tx);

        const refund = await walletsService.credit(tx, {
          walletId: wallet.id,
          amount: booking.totalAmount,
          type: WalletLedgerType.CREDIT_REFUND,
          idempotencyKey: `refund:${booking.id}`,
          referenceType: 'booking',
          referenceId: booking.id,
        });

        const accrual = await commissionsRepository.findAccrualByBooking(booking.id, tx);
        const previousCommissionStatus = accrual?.status ?? null;
        await commissionsRepository.markClawedBack(booking.id, tx);

        await auditService.record(
          {
            actorAdminId: input.actorAdminId,
            action: 'booking.cancelled.admin',
            resourceType: 'booking',
            resourceId: booking.id,
            requestId: input.requestId,
            metadata: {
              officeId: booking.officeId,
              reason: input.reason,
              refundedAmountMinor: booking.totalAmount,
              commissionClawedBack: accrual?.amount ?? 0,
              previousCommissionStatus,
              balanceAfter: refund.entry.balanceAfter,
            },
          },
          tx,
        );

        return {
          balanceAfter: refund.entry.balanceAfter,
          clawedBack: accrual?.amount ?? 0,
          replayed: refund.replayed,
        };
      },
      { isolationLevel: ISOLATION, maxWait: 10_000, timeout: 20_000 },
    );

    const updated = await bookingsRepository.findByIdUnscoped(booking.id);
    if (!updated) throw BookingErrors.notFound();
    return {
      booking: toBookingDto(updated),
      refundedAmountMinor: booking.totalAmount,
      commissionClawedBackMinor: outcome.clawedBack,
      balanceAfterMinor: outcome.balanceAfter,
      replayed: outcome.replayed,
    };
  }

  // ------------------------------------------------------------- dispatch

  /**
   * Build a print-ready TicketDocument + PDF. WhatsApp/SMS channels record the
   * attempt for a future provider and return the same payload as download.
   */
  async dispatch(
    actor: BrokerActor,
    input: { bookingId: string; channel: 'download' | 'whatsapp' | 'sms'; requestId?: string },
  ): Promise<TicketDispatchResult> {
    if (input.channel !== 'download') {
      throw new AppError({
        message: 'WhatsApp and SMS ticket delivery are disabled until a provider is selected',
        statusCode: 422,
        code: ErrorCodes.TICKET_CHANNEL_DISABLED,
        details: { channel: input.channel },
      });
    }

    const dto = await this.getById(actor, input.bookingId);
    if (dto.status !== BookingStatus.CONFIRMED) {
      throw AppError.conflict('Only confirmed bookings can be dispatched', { status: dto.status });
    }

    const office = await bookingsRepository.findOffice(actor.officeId);
    if (!office) throw WalletErrors.walletNotFound();

    const document = this.buildTicketDocument(dto, office);
    const pdfBuffer = await pdfTicketRenderer.renderPdf(document);
    const status = TicketDispatchStatus.READY;

    const attempt = await getPrisma().ticketDispatchAttempt.create({
      data: {
        bookingId: dto.id,
        employeeId: actor.employeeId,
        channel: CHANNEL_TO_ENUM[input.channel],
        status,
        payloadJson: document as unknown as Prisma.InputJsonValue,
      },
    });

    await auditService.record({
      action: 'booking.dispatched',
      resourceType: 'booking',
      resourceId: dto.id,
      requestId: input.requestId,
      metadata: {
        officeId: actor.officeId,
        employeeId: actor.employeeId,
        channel: input.channel,
        status,
        attemptId: attempt.id,
        ticketCount: document.passengers.length,
      },
    });

    return {
      bookingId: dto.id,
      channel: input.channel,
      status,
      document,
      pdfBase64: pdfBuffer.toString('base64'),
      pdfContentType: 'application/pdf',
      attemptId: attempt.id,
    };
  }

  /** Raw PDF bytes for a single ticket (application/pdf). Read-only — no dispatch attempt. */
  async getTicketPdf(
    actor: BrokerActor,
    input: { bookingId: string; ticketNumber: string },
  ): Promise<{ buffer: Buffer; filename: string }> {
    const dto = await this.getById(actor, input.bookingId);
    return this.renderConfirmedTicketPdf(dto, actor.officeId, input.ticketNumber);
  }

  /**
   * Admin PDF: same generator and cancelled-ticket policy as broker GET.
   * Not scoped to an office. Does not record TicketDispatchAttempt (broker GET also does not).
   */
  async getAdminTicketPdf(input: {
    bookingId: string;
    ticketNumber: string;
  }): Promise<{ buffer: Buffer; filename: string }> {
    const dto = await this.getAdminById(input.bookingId);
    if (!dto.officeId) throw BookingErrors.brokerChannelRequired(dto.id);
    return this.renderConfirmedTicketPdf(dto, dto.officeId, input.ticketNumber);
  }

  private async renderConfirmedTicketPdf(
    dto: BookingDto,
    officeId: string,
    ticketNumber: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    if (dto.status !== BookingStatus.CONFIRMED) {
      throw AppError.conflict('Only confirmed bookings have printable tickets', {
        status: dto.status,
      });
    }

    const ticket = dto.tickets.find((t) => t.ticketNumber === ticketNumber);
    if (!ticket || ticket.status !== TicketStatus.CONFIRMED) {
      throw BookingErrors.notFound();
    }

    const office = await bookingsRepository.findOffice(officeId);
    if (!office) throw WalletErrors.walletNotFound();

    const fullDoc = this.buildTicketDocument(dto, office);
    const single: TicketDocument = {
      ...fullDoc,
      passengers: fullDoc.passengers.filter((p) => p.ticketNumber === ticketNumber),
    };
    if (single.passengers.length === 0) throw BookingErrors.notFound();

    const buffer = await pdfTicketRenderer.renderPdf(single);
    const safe = ticketNumber.replace(/[^A-Za-z0-9._-]+/g, '_') || 'ticket';
    return { buffer, filename: `${safe}.pdf` };
  }

  private buildTicketDocument(
    dto: BookingDto,
    office: { id: string; name: string; code: string },
  ): TicketDocument {
    const passengerById = new Map(dto.passengers.map((p) => [p.id, p]));
    const unitPrice =
      dto.tickets.length > 0 ? Math.round(dto.totalAmountMinor / dto.tickets.length) : 0;

    const passengers = dto.tickets
      .filter((t) => t.status === TicketStatus.CONFIRMED)
      .map((t) => {
        const passenger = passengerById.get(t.passengerId);
        return {
          name: passenger?.fullName ?? '—',
          phone: passenger?.phone ?? null,
          seatLabel: t.seatLabel ?? '—',
          ticketNumber: t.ticketNumber,
          fareAmountMinor: unitPrice,
          qrPayload: ticketQrPayload(t.ticketNumber, dto.trip.id),
        };
      })
      .sort((a, b) => compareSeatLabels(a.seatLabel, b.seatLabel));

    return {
      bookingId: dto.id,
      issuedAt: new Date().toISOString(),
      office: { id: office.id, name: office.name, code: office.code },
      carrier: {
        id: dto.trip.company.id,
        name: dto.trip.company.name,
        code: dto.trip.company.key,
      },
      trip: {
        id: dto.trip.id,
        origin: dto.trip.origin,
        destination: dto.trip.destination,
        departureAt: dto.trip.departureAt,
        basePriceMinor: unitPrice,
      },
      passengers,
      totals: {
        totalAmountMinor: dto.totalAmountMinor,
        commissionAmountMinor: dto.commissionAmountMinor,
        currency: 'SDG',
      },
    };
  }
}

export const bookingsService = new BookingsService();

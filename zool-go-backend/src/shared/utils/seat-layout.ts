import { z } from 'zod';

/**
 * Vehicle seat layout stored in `Vehicle.seatLayout` and copied onto `TripSeat` rows.
 * Labels are what every app shows (one format everywhere — SCREEN_API_MAP §4.2).
 */
export const seatLayoutSchema = z
  .object({
    rows: z.number().int().min(1).max(30),
    columns: z.number().int().min(1).max(6),
    /** Aisle is drawn after this column (e.g. 2 for a 2+2 bus) */
    aisleAfterColumn: z.number().int().min(0).max(6),
    driverSide: z.enum(['LEFT', 'RIGHT']),
    seats: z
      .array(
        z.object({
          label: z.string().min(1).max(8),
          row: z.number().int().min(1),
          column: z.number().int().min(1),
          isWomenOnly: z.boolean().default(false),
        }),
      )
      .min(1),
  })
  .strict()
  .superRefine((layout, ctx) => {
    const labels = new Set<string>();
    const cells = new Set<string>();
    layout.seats.forEach((seat, i) => {
      if (labels.has(seat.label)) {
        ctx.addIssue({ code: 'custom', path: ['seats', i, 'label'], message: `Duplicate seat label ${seat.label}` });
      }
      labels.add(seat.label);
      const cell = `${seat.row}:${seat.column}`;
      if (cells.has(cell)) {
        ctx.addIssue({ code: 'custom', path: ['seats', i], message: `Two seats at row ${seat.row}, column ${seat.column}` });
      }
      cells.add(cell);
      if (seat.row > layout.rows || seat.column > layout.columns) {
        ctx.addIssue({ code: 'custom', path: ['seats', i], message: 'Seat outside the layout grid' });
      }
    });
  });

export type SeatLayout = z.infer<typeof seatLayoutSchema>;

/**
 * Standard numbered bus: `rows` rows of `columns` seats (aisle after `aisleAfterColumn`),
 * labels "1".."N" left-to-right, front-to-back.
 */
export function buildNumberedLayout(input: {
  rows: number;
  columns?: number;
  aisleAfterColumn?: number;
  womenOnlyLabels?: string[];
  driverSide?: 'LEFT' | 'RIGHT';
}): SeatLayout {
  const columns = input.columns ?? 4;
  const womenOnly = new Set(input.womenOnlyLabels ?? []);
  const seats: SeatLayout['seats'] = [];
  let n = 1;
  for (let row = 1; row <= input.rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      const label = String(n);
      seats.push({ label, row, column, isWomenOnly: womenOnly.has(label) });
      n += 1;
    }
  }
  return seatLayoutSchema.parse({
    rows: input.rows,
    columns,
    aisleAfterColumn: input.aisleAfterColumn ?? Math.floor(columns / 2),
    driverSide: input.driverSide ?? 'LEFT',
    seats,
  });
}

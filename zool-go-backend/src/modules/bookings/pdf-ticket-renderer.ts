import PDFDocument from 'pdfkit';
import type { TicketDocument } from './ticket-document.js';

export interface TicketDispatchPort {
  renderPdf(document: TicketDocument): Promise<Buffer>;
}

/**
 * Print-ready PDF for broker ticket download / future WhatsApp-SMS providers.
 * Uses built-in fonts (Latin + digit layout); Arabic text is emitted as UTF-8
 * where the font supports it — layout stays clean and printable.
 */
export class PdfTicketRenderer implements TicketDispatchPort {
  async renderPdf(document: TicketDocument): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(18).text('Zool Go — Travel Ticket', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#555555').text(`Issued: ${document.issuedAt}`, {
        align: 'center',
      });
      doc.fillColor('#000000');
      doc.moveDown();

      doc.fontSize(12).text(`Booking: ${document.bookingId}`);
      doc.text(`Office: ${document.office.name} (${document.office.code})`);
      doc.text(`Carrier: ${document.carrier.name} (${document.carrier.code})`);
      doc.moveDown(0.5);

      doc.fontSize(12).text('Trip', { underline: true });
      doc.fontSize(11).text(`${document.trip.origin} → ${document.trip.destination}`);
      doc.text(`Departure: ${document.trip.departureAt}`);
      doc.text(`Base fare: ${document.trip.basePriceMinor} ${document.totals.currency}`);
      doc.moveDown();

      doc.fontSize(12).text('Passengers / Seats', { underline: true });
      doc.moveDown(0.3);

      for (const p of document.passengers) {
        doc
          .fontSize(11)
          .text(
            `${p.ticketNumber}  |  Seat ${p.seatLabel}  |  ${p.name}` +
              (p.phone ? `  |  ${p.phone}` : '') +
              `  |  ${p.fareAmountMinor} ${document.totals.currency}`,
          );
      }

      doc.moveDown();
      doc.fontSize(12).text('Totals', { underline: true });
      doc
        .fontSize(11)
        .text(`Gross: ${document.totals.totalAmountMinor} ${document.totals.currency}`);
      doc.text(
        `Commission: ${document.totals.commissionAmountMinor} ${document.totals.currency}`,
      );

      doc.moveDown(2);
      doc
        .fontSize(9)
        .fillColor('#666666')
        .text('This document is a print-ready ticket record. Present at boarding.', {
          align: 'center',
        });

      doc.end();
    });
  }
}

export const pdfTicketRenderer = new PdfTicketRenderer();

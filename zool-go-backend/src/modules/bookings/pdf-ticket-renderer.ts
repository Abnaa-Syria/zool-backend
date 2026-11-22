import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import type { TicketDocument } from './ticket-document.js';

export interface TicketDispatchPort {
  renderPdf(document: TicketDocument): Promise<Buffer>;
}

function sdg(minor: number): string {
  return `${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} SDG`;
}

/**
 * Print-ready passenger ticket: one block per passenger with the signed boarding QR code the
 * driver app scans. Passenger-facing, so it never shows broker commission. Built-in fonts are
 * Latin-only; Arabic names print as-is where the font has glyphs (an embedded Arabic font with
 * shaping is a phase 7 item).
 */
export class PdfTicketRenderer implements TicketDispatchPort {
  async renderPdf(document: TicketDocument): Promise<Buffer> {
    const qrImages = await Promise.all(
      document.passengers.map((p) => QRCode.toBuffer(p.qrPayload, { type: 'png', errorCorrectionLevel: 'M', margin: 1, width: 220 })),
    );
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(18).text('Zool Go - Travel Ticket', { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(9).fillColor('#555555').text(`Issued ${document.issuedAt}`, { align: 'center' });
      doc.fillColor('#000000').moveDown();

      doc.fontSize(11).text(`Carrier: ${document.carrier.name}`);
      doc.text(`Route: ${document.trip.origin} -> ${document.trip.destination}`);
      doc.text(`Departure: ${document.trip.departureAt}`);
      doc.text(`Sold by: ${document.office ? `${document.office.name} (${document.office.code})` : 'Zool Go app'}`);
      doc.moveDown();

      document.passengers.forEach((p, i) => {
        if (doc.y > 600) doc.addPage();
        const top = doc.y;
        doc.roundedRect(50, top, 495, 150, 8).strokeColor('#cccccc').stroke();
        doc.image(qrImages[i]!, 60, top + 10, { width: 130, height: 130 });
        doc
          .fontSize(13)
          .fillColor('#000000')
          .text(p.name, 205, top + 20, { width: 330 })
          .fontSize(11)
          .text(`Ticket ${p.ticketNumber}`, 205, top + 50)
          .text(`Seat ${p.seatLabel}`, 205, top + 70)
          .text(`Fare ${sdg(p.fareAmountMinor)}`, 205, top + 90);
        if (p.phone) doc.text(p.phone, 205, top + 110);
        doc.x = 50;
        doc.y = top + 165;
      });

      doc.moveDown();
      doc.fontSize(11).text(`Total paid: ${sdg(document.totals.totalAmountMinor)}`, 50);
      doc.moveDown(2);
      doc.fontSize(9).fillColor('#666666').text('Show the QR code to the driver at boarding.', 50, doc.y, { align: 'center', width: 495 });
      doc.end();
    });
  }
}

export const pdfTicketRenderer = new PdfTicketRenderer();

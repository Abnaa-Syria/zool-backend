import path from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { env } from '../../config/env';
import type { TicketDocument } from './ticket-document.js';

export interface TicketDispatchPort {
  renderPdf(document: TicketDocument): Promise<Buffer>;
}

const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts');
const FONT_REGULAR = path.join(FONT_DIR, 'IBMPlexSansArabic-Regular.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'IBMPlexSansArabic-Bold.ttf');

const ARABIC = /[؀-ۿ]/;
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const BRAND = '#0B3B60';
const MUTED = '#5B6B7A';

/**
 * pdfkit shapes Arabic through fontkit but lays glyphs out left-to-right. With the `rtla`
 * feature the Arabic order is right; runs of digits/Latin then come out mirrored, so they are
 * pre-reversed here, and brackets are swapped. Callers keep values short (one line, no wrapping).
 */
export function visualRtl(text: string): { text: string; features: PDFKit.Mixins.OpenTypeFeatures[] } {
  if (!ARABIC.test(text)) return { text, features: [] };
  const reversedRuns = text.replace(/[A-Za-z0-9][A-Za-z0-9.,:\-/+_]*/g, (m) => [...m].reverse().join(''));
  const swapped = reversedRuns.replace(/[()]/g, (c) => (c === '(' ? ')' : '('));
  return { text: swapped, features: ['rtla'] };
}

function sdg(minor: number): string {
  return (minor / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Departure as Sudan local time: "23 نوفمبر 2026 - 07:00". */
function sudanDateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: env().PLATFORM_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${Number(get('day'))} ${MONTHS_AR[Number(get('month')) - 1]} ${get('year')} - ${get('hour').replace('24', '00')}:${get('minute')}`;
}

/**
 * Passenger ticket (A4): Arabic-first, one card per passenger with the signed boarding QR the
 * driver app scans. Passenger-facing, so broker commission never appears. Font: IBM Plex Sans
 * Arabic (OFL, same family as the dashboards), embedded from `assets/fonts`.
 */
export class PdfTicketRenderer implements TicketDispatchPort {
  async renderPdf(document: TicketDocument): Promise<Buffer> {
    const qrImages = await Promise.all(
      document.passengers.map((p) => QRCode.toBuffer(p.qrPayload, { type: 'png', errorCorrectionLevel: 'M', margin: 1, width: 260 })),
    );
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Zool Go ticket ${document.bookingId}` } });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.registerFont('ar', FONT_REGULAR);
      doc.registerFont('ar-bold', FONT_BOLD);

      const W = doc.page.width;
      const left = 40;
      const right = W - 40;
      const width = right - left;

      /** One line of text; Arabic is right-aligned within [x, x + w]. */
      const line = (text: string, x: number, y: number, w: number, opts: { size?: number; bold?: boolean; color?: string; align?: 'left' | 'right' | 'center' } = {}) => {
        const { text: t, features } = visualRtl(text);
        doc
          .font(opts.bold ? 'ar-bold' : 'ar')
          .fontSize(opts.size ?? 11)
          .fillColor(opts.color ?? '#111111')
          .text(t, x, y, { width: w, align: opts.align ?? (ARABIC.test(text) ? 'right' : 'left'), lineBreak: false, ellipsis: true, features });
      };

      // Header band
      doc.rect(0, 0, W, 86).fill(BRAND);
      line('زول قو - تذكرة سفر', left, 22, width, { size: 22, bold: true, color: '#FFFFFF', align: 'right' });
      line('Zool Go - Travel ticket', left, 30, width / 2, { size: 12, color: '#D6E4F0', align: 'left' });
      line(`الحجز ${document.bookingId}`, left, 56, width, { size: 11, color: '#D6E4F0', align: 'right' });

      // Trip block
      let y = 110;
      doc.roundedRect(left, y, width, 96, 10).lineWidth(1).strokeColor('#D8E1EA').stroke();
      line(`${document.trip.origin} ← ${document.trip.destination}`, left + 16, y + 14, width - 32, { size: 18, bold: true, align: 'right' });
      line(`المغادرة: ${sudanDateTime(document.trip.departureAt)} (بتوقيت السودان)`, left + 16, y + 44, width - 32, { size: 11, align: 'right' });
      line(`شركة النقل: ${document.carrier.name}${document.carrier.code ? ` - رحلة ${document.carrier.code}` : ''}`, left + 16, y + 66, width - 32, { size: 11, color: MUTED, align: 'right' });
      y += 116;

      // One card per passenger
      document.passengers.forEach((p, i) => {
        if (y + 170 > doc.page.height - 80) {
          doc.addPage();
          y = 40;
        }
        doc.roundedRect(left, y, width, 160, 10).lineWidth(1).strokeColor('#D8E1EA').stroke();
        doc.image(qrImages[i]!, left + 14, y + 14, { width: 132, height: 132 });
        const tx = left + 160;
        const tw = width - 176;
        line(p.name, tx, y + 18, tw, { size: 16, bold: true, align: 'right' });
        line(`المقعد: ${p.seatLabel}`, tx, y + 48, tw, { size: 13, align: 'right' });
        line(`رقم التذكرة: ${p.ticketNumber}`, tx, y + 74, tw, { size: 11, align: 'right' });
        line(`الأجرة: ${sdg(p.fareAmountMinor)} ج.س`, tx, y + 98, tw, { size: 11, align: 'right' });
        if (p.phone) line(p.phone, tx, y + 122, tw, { size: 10, color: MUTED, align: 'right' });
        y += 172;
      });

      // Totals and footer
      line(`الإجمالي المدفوع: ${sdg(document.totals.totalAmountMinor)} ج.س`, left, y + 4, width, { size: 13, bold: true, align: 'right' });
      line(document.office ? `صادرة من: ${document.office.name}` : 'صادرة من تطبيق زول قو', left, y + 28, width, { size: 10, color: MUTED, align: 'right' });
      line('اعرض رمز QR على السائق عند الصعود. الرمز موقّع ولا يصلح لرحلة أخرى.', left, doc.page.height - 60, width, { size: 9, color: MUTED, align: 'center' });
      line(`Issued ${document.issuedAt}`, left, doc.page.height - 44, width, { size: 8, color: MUTED, align: 'center' });
      doc.end();
    });
  }
}

export const pdfTicketRenderer = new PdfTicketRenderer();

export type TicketDocumentPassenger = {
  name: string;
  phone: string | null;
  seatLabel: string;
  ticketNumber: string;
  fareAmountMinor: number;
};

export type TicketDocument = {
  bookingId: string;
  issuedAt: string;
  office: {
    id: string;
    name: string;
    code: string;
  };
  carrier: {
    id: string;
    name: string;
    code: string;
  };
  trip: {
    id: string;
    origin: string;
    destination: string;
    departureAt: string;
    basePriceMinor: number;
  };
  passengers: TicketDocumentPassenger[];
  totals: {
    totalAmountMinor: number;
    commissionAmountMinor: number;
    currency: 'SDG';
  };
};

export type TicketDispatchResult = {
  bookingId: string;
  channel: 'download' | 'whatsapp' | 'sms';
  status: 'READY' | 'RECORDED';
  document: TicketDocument;
  pdfBase64: string;
  pdfContentType: 'application/pdf';
  attemptId: string;
};

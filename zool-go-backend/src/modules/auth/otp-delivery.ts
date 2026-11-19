export interface SendOtpInput {
  destination: string;
  code: string;
  purpose: string;
}

export interface OtpDeliveryProvider {
  sendOtp(input: SendOtpInput): Promise<void>;
}

/** Development provider: does not send externally; OTP may be exposed via API under guards. */
export class DevOtpDeliveryProvider implements OtpDeliveryProvider {
  async sendOtp(_input: SendOtpInput): Promise<void> {
    // Intentionally no-op and never logs the OTP.
  }
}

let provider: OtpDeliveryProvider = new DevOtpDeliveryProvider();

export function getOtpDeliveryProvider(): OtpDeliveryProvider {
  return provider;
}

export function setOtpDeliveryProvider(next: OtpDeliveryProvider): void {
  provider = next;
}

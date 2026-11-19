import type { BrokerEmployeeFlags } from '../../shared/constants/broker-permissions';

export interface BrokerMeDto {
  id: string;
  displayName: string;
  role: 'MANAGER' | 'CLERK';
  status: string;
  permissions: string[];
  flags: BrokerEmployeeFlags;
  office: {
    id: string;
    code: string;
    name: string;
    status: string;
  };
  identities: Array<{ type: string; value: string; isPrimary: boolean }>;
}

export interface BrokerOtpRequestResultDto {
  challengeId: string;
  expiresAt: string;
  cooldownSeconds: number;
  /** Present only when NODE_ENV !== production AND OTP_DEV_EXPOSE=true */
  devOtp?: string;
}

export interface BrokerAuthTokensDto {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  employee: BrokerMeDto;
}

import type { PermissionKey } from '../../shared/constants/permissions';

export interface AuthMeDto {
  id: string;
  employeeCode: string;
  displayName: string;
  status: string;
  isBootstrap: boolean;
  roles: Array<{ id: string; key: string; name: string }>;
  permissions: PermissionKey[];
  identities: Array<{ type: string; value: string; isPrimary: boolean }>;
}

export interface OtpRequestResultDto {
  challengeId: string;
  expiresAt: string;
  cooldownSeconds: number;
  /** Present only when NODE_ENV !== production AND OTP_DEV_EXPOSE=true */
  devOtp?: string;
}

export interface AuthTokensDto {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  admin: AuthMeDto;
}

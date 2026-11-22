import { DriverStatus } from '@prisma/client';
import { AppError } from '../../shared/errors/app-error';
import { driverProfileRepository } from './driver-profile.repository';

const EXPIRING_SOON_DAYS = 30;

function licenseStatus(expiry: Date | null): 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | 'UNKNOWN' {
  if (!expiry) return 'UNKNOWN';
  const days = (expiry.getTime() - Date.now()) / 86_400_000;
  if (days < 0) return 'EXPIRED';
  return days <= EXPIRING_SOON_DAYS ? 'EXPIRING_SOON' : 'VALID';
}

export class DriverProfileService {
  async me(driverId: string) {
    const d = await driverProfileRepository.findById(driverId);
    if (!d || d.status !== DriverStatus.ACTIVE) throw AppError.unauthorized('Driver account is not active');
    return {
      id: d.id,
      driverCode: d.driverCode,
      displayName: d.displayName,
      phone: d.identities[0]?.valueNormalized ?? null,
      avatarUrl: d.avatarUrl,
      company: {
        id: d.company.id,
        name: d.company.shortName ?? d.company.name,
        legalName: d.company.name,
        logoUrl: d.company.logoUrl,
        status: d.company.status,
      },
      license: {
        number: d.licenseNumber,
        expiry: d.licenseExpiry ? d.licenseExpiry.toISOString().slice(0, 10) : null,
        status: licenseStatus(d.licenseExpiry),
      },
    };
  }
}

export const driverProfileService = new DriverProfileService();

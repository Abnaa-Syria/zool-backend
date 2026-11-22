import { CustomerStatus } from '@prisma/client';
import { getPrisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { setPrincipalAuthzVersion } from '../../shared/security/principal-authz-cache';
import { runtimeSettings } from '../../shared/settings/runtime-settings';
import { auditService } from '../audit/audit.service';
import { customerProfileRepository, type CustomerProfileRow } from './customer-profile.repository';

function toMe(c: CustomerProfileRow) {
  const noShowLimit = runtimeSettings.number('cash.noShowLimit');
  return {
    id: c.id,
    displayName: c.displayName,
    phone: c.identities[0]?.valueNormalized ?? null,
    email: c.email,
    avatarUrl: c.avatarUrl,
    preferences: { language: c.preferredLanguage, tripAlerts: c.tripAlertsEnabled },
    /** True until the customer saves a name (first-login "your name" step) */
    profileIncomplete: !c.displayName,
    cash: {
      noShowCount: c.cashNoShowCount,
      noShowLimit,
      /** Account-level eligibility only; checkout also checks carrier, cutoff and seat limits */
      eligible: runtimeSettings.boolean('cash.enabled') && c.cashNoShowCount < noShowLimit,
    },
    createdAt: c.createdAt.toISOString(),
  };
}

export class CustomerProfileService {
  private async load(customerId: string) {
    const c = await customerProfileRepository.findById(customerId);
    if (!c || c.status !== CustomerStatus.ACTIVE) throw AppError.unauthorized('Customer account is not active');
    return c;
  }

  /** Compact profile embedded in login/refresh responses. */
  async summary(customerId: string) {
    return toMe(await this.load(customerId));
  }

  async me(customerId: string) {
    const c = await this.load(customerId);
    return { ...toMe(c), stats: await customerProfileRepository.travelStats(customerId) };
  }

  async update(customerId: string, input: { displayName?: string; email?: string | null }) {
    await this.load(customerId);
    await customerProfileRepository.update(customerId, {
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.email !== undefined ? { email: input.email?.toLowerCase() ?? null } : {}),
    });
    return this.me(customerId);
  }

  async updatePreferences(customerId: string, input: { language?: 'ar' | 'en'; tripAlerts?: boolean }) {
    await this.load(customerId);
    await customerProfileRepository.update(customerId, {
      ...(input.language ? { preferredLanguage: input.language } : {}),
      ...(input.tripAlerts !== undefined ? { tripAlertsEnabled: input.tripAlerts } : {}),
    });
    return this.me(customerId);
  }

  /**
   * Account deletion: PII is removed and the phone is freed (a later login creates a new
   * account); bookings stay for accounting. Blocked while a trip is still ahead.
   */
  async deleteAccount(customerId: string, requestId?: string) {
    await this.load(customerId);
    if ((await customerProfileRepository.countActiveBookings(customerId)) > 0) {
      throw new AppError({
        statusCode: 409,
        code: ErrorCodes.ACCOUNT_HAS_ACTIVE_BOOKINGS,
        message: 'Cancel or complete upcoming trips before deleting the account',
      });
    }
    const updated = await getPrisma().$transaction(async (tx) => {
      const row = await customerProfileRepository.anonymise(customerId, tx);
      await auditService.record(
        { action: 'customer.account.deleted', resourceType: 'customer', resourceId: customerId, requestId },
        tx,
      );
      return row;
    });
    await setPrincipalAuthzVersion('customer', customerId, updated.authzVersion);
    return { deleted: true };
  }
}

export const customerProfileService = new CustomerProfileService();

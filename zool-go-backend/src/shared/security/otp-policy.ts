import { runtimeSettings } from '../settings/runtime-settings';

/** Login-code limits from admin settings (defaults come from .env). Read per request. */
export function otpPolicy() {
  return {
    requestsPerPhone: runtimeSettings.number('security.otpRequestsPerPhone'),
    verifiesPerPhone: runtimeSettings.number('security.otpVerifiesPerPhone'),
    requestsPerIp: runtimeSettings.number('security.otpRequestsPerIp'),
    cooldownSeconds: runtimeSettings.number('security.otpResendCooldownSeconds'),
    maxAttempts: runtimeSettings.number('security.otpMaxAttempts'),
  };
}

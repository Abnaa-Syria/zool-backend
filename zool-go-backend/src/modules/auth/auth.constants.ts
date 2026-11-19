export const AUTH_COOKIE = {
  // name comes from env at runtime
} as const;

export const OTP_REDIS = {
  cooldown: (identity: string) => `otp:cooldown:${identity}`,
  requestRate: (identity: string) => `otp:req:${identity}`,
  verifyRate: (identity: string) => `otp:verify:${identity}`,
  activeChallenge: (identity: string) => `otp:active:${identity}`,
  /** Prefix so phone-change OTP does not share login cooldown/challenge keys. */
  phoneChange: (identity: string) => `phone_change:${identity}`,
} as const;

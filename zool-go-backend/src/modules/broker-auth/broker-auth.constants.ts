/** Redis logical keys for broker OTP; kept separate from admin OTP keys. */
export const BROKER_OTP_REDIS = {
  cooldown: (identity: string) => `broker:otp:cooldown:${identity}`,
  requestRate: (identity: string) => `broker:otp:req:${identity}`,
  verifyRate: (identity: string) => `broker:otp:verify:${identity}`,
  activeChallenge: (identity: string) => `broker:otp:active:${identity}`,
} as const;

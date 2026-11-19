-- Self-service admin phone change OTP (cannot reuse ADMIN_LOGIN: that purpose requires an existing identity)

ALTER TABLE `otp_challenges` MODIFY `purpose` ENUM('ADMIN_LOGIN', 'ADMIN_PHONE_CHANGE') NOT NULL;

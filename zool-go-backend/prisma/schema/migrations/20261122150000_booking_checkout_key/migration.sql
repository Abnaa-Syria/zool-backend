-- Customer checkout idempotency (phase 6)
ALTER TABLE `bookings` ADD COLUMN `checkout_key` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `bookings_checkout_key_key` ON `bookings`(`checkout_key`);

-- CreateTable
CREATE TABLE `bookings` (
    `id` VARCHAR(191) NOT NULL,
    `office_id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `trip_id` VARCHAR(191) NOT NULL,
    `status` ENUM('CONFIRMED', 'CANCELLED') NOT NULL DEFAULT 'CONFIRMED',
    `total_amount` INTEGER NOT NULL,
    `commission_amount` INTEGER NOT NULL,
    `confirmed_at` DATETIME(3) NOT NULL,
    `cancelled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bookings_office_id_created_at_idx`(`office_id`, `created_at`),
    INDEX `bookings_employee_id_created_at_idx`(`employee_id`, `created_at`),
    INDEX `bookings_trip_id_status_idx`(`trip_id`, `status`),
    INDEX `bookings_status_confirmed_at_idx`(`status`, `confirmed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `booking_passengers` (
    `id` VARCHAR(191) NOT NULL,
    `booking_id` VARCHAR(191) NOT NULL,
    `full_name` VARCHAR(160) NOT NULL,
    `phone` VARCHAR(32) NOT NULL,
    `id_number` VARCHAR(64) NULL,

    INDEX `booking_passengers_booking_id_idx`(`booking_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tickets` (
    `id` VARCHAR(191) NOT NULL,
    `booking_id` VARCHAR(191) NOT NULL,
    `trip_seat_id` VARCHAR(191) NULL,
    `passenger_id` VARCHAR(191) NOT NULL,
    `ticket_number` VARCHAR(64) NOT NULL,
    `status` ENUM('CONFIRMED', 'CANCELLED') NOT NULL DEFAULT 'CONFIRMED',

    UNIQUE INDEX `tickets_ticket_number_key`(`ticket_number`),
    INDEX `tickets_booking_id_idx`(`booking_id`),
    INDEX `tickets_trip_seat_id_idx`(`trip_seat_id`),
    INDEX `tickets_passenger_id_idx`(`passenger_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `broker_offices` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `min_top_up_override` INTEGER NULL,
    `exposure_ceiling_override` INTEGER NULL,
    `settlement_period` ENUM('WEEKLY', 'MONTHLY') NOT NULL,
    `last_settled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `broker_offices_code_key`(`code`),
    INDEX `broker_offices_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `broker_employees` (
    `id` VARCHAR(191) NOT NULL,
    `office_id` VARCHAR(191) NOT NULL,
    `display_name` VARCHAR(160) NOT NULL,
    `role` ENUM('MANAGER', 'CLERK') NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `can_book` BOOLEAN NOT NULL DEFAULT true,
    `can_top_up` BOOLEAN NOT NULL DEFAULT false,
    `can_view_reports` BOOLEAN NOT NULL DEFAULT false,
    `can_manage_staff` BOOLEAN NOT NULL DEFAULT false,
    `authz_version` INTEGER NOT NULL DEFAULT 1,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `broker_employees_office_id_status_idx`(`office_id`, `status`),
    INDEX `broker_employees_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `broker_identities` (
    `id` VARCHAR(191) NOT NULL,
    `broker_employee_id` VARCHAR(191) NOT NULL,
    `type` ENUM('PHONE', 'EMAIL') NOT NULL,
    `value_normalized` VARCHAR(191) NOT NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT true,
    `verified_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `broker_identities_broker_employee_id_idx`(`broker_employee_id`),
    UNIQUE INDEX `broker_identities_type_value_normalized_key`(`type`, `value_normalized`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `broker_refresh_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `broker_employee_id` VARCHAR(191) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `family_id` VARCHAR(64) NOT NULL,
    `replaced_by_id` VARCHAR(191) NULL,
    `user_agent` VARCHAR(512) NULL,
    `ip_address` VARCHAR(64) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoke_reason` VARCHAR(120) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_used_at` DATETIME(3) NULL,

    UNIQUE INDEX `broker_refresh_sessions_token_hash_key`(`token_hash`),
    INDEX `broker_refresh_sessions_broker_employee_id_revoked_at_idx`(`broker_employee_id`, `revoked_at`),
    INDEX `broker_refresh_sessions_family_id_idx`(`family_id`),
    INDEX `broker_refresh_sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `broker_otp_challenges` (
    `id` VARCHAR(191) NOT NULL,
    `broker_employee_id` VARCHAR(191) NOT NULL,
    `identity_type` ENUM('PHONE', 'EMAIL') NOT NULL,
    `identity_value` VARCHAR(191) NOT NULL,
    `purpose` ENUM('BROKER_LOGIN') NOT NULL,
    `code_hash` VARCHAR(128) NOT NULL,
    `status` ENUM('PENDING', 'CONSUMED', 'EXPIRED', 'LOCKED') NOT NULL DEFAULT 'PENDING',
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `max_attempts` INTEGER NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `consumed_at` DATETIME(3) NULL,
    `request_id` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `broker_otp_challenges_broker_employee_id_purpose_status_idx`(`broker_employee_id`, `purpose`, `status`),
    INDEX `broker_otp_challenges_identity_value_purpose_status_idx`(`identity_value`, `purpose`, `status`),
    INDEX `broker_otp_challenges_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_companies` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `transport_companies_key_key`(`key`),
    INDEX `transport_companies_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `broker_carrier_assignments` (
    `id` VARCHAR(191) NOT NULL,
    `office_id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `commission_percent` DECIMAL(5, 2) NOT NULL,

    INDEX `broker_carrier_assignments_company_id_idx`(`company_id`),
    UNIQUE INDEX `broker_carrier_assignments_office_id_company_id_key`(`office_id`, `company_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trips` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `origin` VARCHAR(120) NOT NULL,
    `destination` VARCHAR(120) NOT NULL,
    `departure_at` DATETIME(3) NOT NULL,
    `base_price` INTEGER NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `trips_company_id_departure_at_idx`(`company_id`, `departure_at`),
    INDEX `trips_is_active_departure_at_idx`(`is_active`, `departure_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trip_seats` (
    `id` VARCHAR(191) NOT NULL,
    `trip_id` VARCHAR(191) NOT NULL,
    `seat_label` VARCHAR(32) NOT NULL,
    `status` ENUM('FREE', 'HELD', 'SOLD') NOT NULL DEFAULT 'FREE',

    INDEX `trip_seats_trip_id_status_idx`(`trip_id`, `status`),
    UNIQUE INDEX `trip_seats_trip_id_seat_label_key`(`trip_id`, `seat_label`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seat_holds` (
    `id` VARCHAR(191) NOT NULL,
    `trip_seat_id` VARCHAR(191) NOT NULL,
    `office_id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `seat_holds_trip_seat_id_key`(`trip_seat_id`),
    INDEX `seat_holds_office_id_expires_at_idx`(`office_id`, `expires_at`),
    INDEX `seat_holds_employee_id_idx`(`employee_id`),
    INDEX `seat_holds_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `commission_accruals` (
    `id` VARCHAR(191) NOT NULL,
    `booking_id` VARCHAR(191) NOT NULL,
    `office_id` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `status` ENUM('UNSETTLED', 'SETTLED', 'CLAWED_BACK') NOT NULL DEFAULT 'UNSETTLED',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `commission_accruals_booking_id_key`(`booking_id`),
    INDEX `commission_accruals_office_id_status_idx`(`office_id`, `status`),
    INDEX `commission_accruals_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `commission_payouts` (
    `id` VARCHAR(191) NOT NULL,
    `office_id` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `acted_by_admin_id` VARCHAR(191) NOT NULL,
    `note` VARCHAR(500) NULL,
    `settled_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `commission_payouts_office_id_settled_at_idx`(`office_id`, `settled_at`),
    INDEX `commission_payouts_acted_by_admin_id_idx`(`acted_by_admin_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `top_up_intents` (
    `id` VARCHAR(191) NOT NULL,
    `broker_office_id` VARCHAR(191) NOT NULL,
    `wallet_id` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'CONFIRMED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `provider_ref` VARCHAR(191) NULL,
    `provider` VARCHAR(64) NOT NULL DEFAULT 'mock',
    `idempotency_key` VARCHAR(128) NOT NULL,
    `confirmed_at` DATETIME(3) NULL,
    `created_by_employee_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `top_up_intents_idempotency_key_key`(`idempotency_key`),
    INDEX `top_up_intents_broker_office_id_status_idx`(`broker_office_id`, `status`),
    INDEX `top_up_intents_wallet_id_status_idx`(`wallet_id`, `status`),
    INDEX `top_up_intents_created_by_employee_id_idx`(`created_by_employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wallets` (
    `id` VARCHAR(191) NOT NULL,
    `broker_office_id` VARCHAR(191) NOT NULL,
    `balance` INTEGER NOT NULL DEFAULT 0,
    `currency` CHAR(3) NOT NULL DEFAULT 'SDG',
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `wallets_broker_office_id_key`(`broker_office_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wallet_ledger_entries` (
    `id` VARCHAR(191) NOT NULL,
    `wallet_id` VARCHAR(191) NOT NULL,
    `type` ENUM('CREDIT_TOPUP', 'DEBIT_BOOKING', 'CREDIT_REFUND', 'DEBIT_COMMISSION_PAYOUT') NOT NULL,
    `amount` INTEGER NOT NULL,
    `balance_after` INTEGER NOT NULL,
    `idempotency_key` VARCHAR(128) NOT NULL,
    `reference_type` VARCHAR(64) NULL,
    `reference_id` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `wallet_ledger_entries_idempotency_key_key`(`idempotency_key`),
    INDEX `wallet_ledger_entries_wallet_id_created_at_idx`(`wallet_id`, `created_at`),
    INDEX `wallet_ledger_entries_reference_type_reference_id_idx`(`reference_type`, `reference_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_office_id_fkey` FOREIGN KEY (`office_id`) REFERENCES `broker_offices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `broker_employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_trip_id_fkey` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `booking_passengers` ADD CONSTRAINT `booking_passengers_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_trip_seat_id_fkey` FOREIGN KEY (`trip_seat_id`) REFERENCES `trip_seats`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_passenger_id_fkey` FOREIGN KEY (`passenger_id`) REFERENCES `booking_passengers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `broker_employees` ADD CONSTRAINT `broker_employees_office_id_fkey` FOREIGN KEY (`office_id`) REFERENCES `broker_offices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `broker_identities` ADD CONSTRAINT `broker_identities_broker_employee_id_fkey` FOREIGN KEY (`broker_employee_id`) REFERENCES `broker_employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `broker_refresh_sessions` ADD CONSTRAINT `broker_refresh_sessions_broker_employee_id_fkey` FOREIGN KEY (`broker_employee_id`) REFERENCES `broker_employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `broker_otp_challenges` ADD CONSTRAINT `broker_otp_challenges_broker_employee_id_fkey` FOREIGN KEY (`broker_employee_id`) REFERENCES `broker_employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `broker_carrier_assignments` ADD CONSTRAINT `broker_carrier_assignments_office_id_fkey` FOREIGN KEY (`office_id`) REFERENCES `broker_offices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `broker_carrier_assignments` ADD CONSTRAINT `broker_carrier_assignments_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `transport_companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trips` ADD CONSTRAINT `trips_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `transport_companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trip_seats` ADD CONSTRAINT `trip_seats_trip_id_fkey` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seat_holds` ADD CONSTRAINT `seat_holds_trip_seat_id_fkey` FOREIGN KEY (`trip_seat_id`) REFERENCES `trip_seats`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seat_holds` ADD CONSTRAINT `seat_holds_office_id_fkey` FOREIGN KEY (`office_id`) REFERENCES `broker_offices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seat_holds` ADD CONSTRAINT `seat_holds_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `broker_employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `commission_accruals` ADD CONSTRAINT `commission_accruals_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `commission_accruals` ADD CONSTRAINT `commission_accruals_office_id_fkey` FOREIGN KEY (`office_id`) REFERENCES `broker_offices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `commission_payouts` ADD CONSTRAINT `commission_payouts_office_id_fkey` FOREIGN KEY (`office_id`) REFERENCES `broker_offices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `commission_payouts` ADD CONSTRAINT `commission_payouts_acted_by_admin_id_fkey` FOREIGN KEY (`acted_by_admin_id`) REFERENCES `admin_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `top_up_intents` ADD CONSTRAINT `top_up_intents_broker_office_id_fkey` FOREIGN KEY (`broker_office_id`) REFERENCES `broker_offices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `top_up_intents` ADD CONSTRAINT `top_up_intents_wallet_id_fkey` FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `top_up_intents` ADD CONSTRAINT `top_up_intents_created_by_employee_id_fkey` FOREIGN KEY (`created_by_employee_id`) REFERENCES `broker_employees`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wallets` ADD CONSTRAINT `wallets_broker_office_id_fkey` FOREIGN KEY (`broker_office_id`) REFERENCES `broker_offices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wallet_ledger_entries` ADD CONSTRAINT `wallet_ledger_entries_wallet_id_fkey` FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

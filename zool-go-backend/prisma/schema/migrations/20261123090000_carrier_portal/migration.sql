-- D-CARRIER-PORTAL-01 carrier staff + D-REV-02 settlements + non-admin audit actors (additive)
-- AlterTable
ALTER TABLE `audit_logs` ADD COLUMN `actor_id` VARCHAR(64) NULL,
    ADD COLUMN `actor_type` VARCHAR(32) NULL;

-- AlterTable
ALTER TABLE `transport_companies` ADD COLUMN `broker_commission_bearer` ENUM('CARRIER', 'PLATFORM') NOT NULL DEFAULT 'PLATFORM',
    ADD COLUMN `platform_fee_type` ENUM('NONE', 'PERCENT', 'FIXED') NOT NULL DEFAULT 'NONE',
    ADD COLUMN `platform_fee_value` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `carrier_employees` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `display_name` VARCHAR(160) NOT NULL,
    `role` ENUM('MANAGER', 'STAFF') NOT NULL DEFAULT 'STAFF',
    `status` ENUM('ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `can_manage_fleet` BOOLEAN NOT NULL DEFAULT false,
    `can_manage_schedule` BOOLEAN NOT NULL DEFAULT false,
    `can_view_finance` BOOLEAN NOT NULL DEFAULT false,
    `can_manage_staff` BOOLEAN NOT NULL DEFAULT false,
    `authz_version` INTEGER NOT NULL DEFAULT 1,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `carrier_employees_company_id_status_idx`(`company_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `carrier_identities` (
    `id` VARCHAR(191) NOT NULL,
    `carrier_employee_id` VARCHAR(191) NOT NULL,
    `type` ENUM('PHONE', 'EMAIL') NOT NULL,
    `value_normalized` VARCHAR(191) NOT NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT true,
    `verified_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `carrier_identities_carrier_employee_id_idx`(`carrier_employee_id`),
    UNIQUE INDEX `carrier_identities_type_value_normalized_key`(`type`, `value_normalized`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `carrier_refresh_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `carrier_employee_id` VARCHAR(191) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `family_id` VARCHAR(64) NOT NULL,
    `replaced_by_id` VARCHAR(191) NULL,
    `platform` VARCHAR(16) NULL,
    `user_agent` VARCHAR(512) NULL,
    `ip_address` VARCHAR(64) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoke_reason` VARCHAR(120) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_used_at` DATETIME(3) NULL,

    UNIQUE INDEX `carrier_refresh_sessions_token_hash_key`(`token_hash`),
    INDEX `carrier_refresh_sessions_carrier_employee_id_revoked_at_idx`(`carrier_employee_id`, `revoked_at`),
    INDEX `carrier_refresh_sessions_family_id_idx`(`family_id`),
    INDEX `carrier_refresh_sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `carrier_otp_challenges` (
    `id` VARCHAR(191) NOT NULL,
    `carrier_employee_id` VARCHAR(191) NOT NULL,
    `identity_type` ENUM('PHONE', 'EMAIL') NOT NULL,
    `identity_value` VARCHAR(191) NOT NULL,
    `purpose` ENUM('CARRIER_LOGIN') NOT NULL,
    `code_hash` VARCHAR(128) NOT NULL,
    `status` ENUM('PENDING', 'CONSUMED', 'EXPIRED', 'LOCKED') NOT NULL DEFAULT 'PENDING',
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `max_attempts` INTEGER NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `consumed_at` DATETIME(3) NULL,
    `request_id` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `carrier_otp_challenges_carrier_employee_id_purpose_status_idx`(`carrier_employee_id`, `purpose`, `status`),
    INDEX `carrier_otp_challenges_identity_value_purpose_status_idx`(`identity_value`, `purpose`, `status`),
    INDEX `carrier_otp_challenges_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `carrier_settlements` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `period_from` DATETIME(3) NOT NULL,
    `period_to` DATETIME(3) NOT NULL,
    `status` ENUM('DRAFT', 'FINALIZED', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `fee_type` ENUM('NONE', 'PERCENT', 'FIXED') NOT NULL,
    `fee_value` INTEGER NOT NULL,
    `commission_bearer` ENUM('CARRIER', 'PLATFORM') NOT NULL,
    `tickets_count` INTEGER NOT NULL DEFAULT 0,
    `online_sales_amount` INTEGER NOT NULL DEFAULT 0,
    `broker_sales_amount` INTEGER NOT NULL DEFAULT 0,
    `cash_sales_amount` INTEGER NOT NULL DEFAULT 0,
    `refunds_amount` INTEGER NOT NULL DEFAULT 0,
    `platform_fee_amount` INTEGER NOT NULL DEFAULT 0,
    `broker_commission_amount` INTEGER NOT NULL DEFAULT 0,
    `net_payable_amount` INTEGER NOT NULL DEFAULT 0,
    `lines` JSON NULL,
    `notes` VARCHAR(1000) NULL,
    `payment_reference` VARCHAR(191) NULL,
    `created_by_admin_id` VARCHAR(191) NULL,
    `finalized_at` DATETIME(3) NULL,
    `paid_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `carrier_settlements_company_id_period_from_idx`(`company_id`, `period_from`),
    INDEX `carrier_settlements_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `audit_logs_actor_type_actor_id_created_at_idx` ON `audit_logs`(`actor_type`, `actor_id`, `created_at`);

-- AddForeignKey
ALTER TABLE `carrier_employees` ADD CONSTRAINT `carrier_employees_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `transport_companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carrier_identities` ADD CONSTRAINT `carrier_identities_carrier_employee_id_fkey` FOREIGN KEY (`carrier_employee_id`) REFERENCES `carrier_employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carrier_refresh_sessions` ADD CONSTRAINT `carrier_refresh_sessions_carrier_employee_id_fkey` FOREIGN KEY (`carrier_employee_id`) REFERENCES `carrier_employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carrier_otp_challenges` ADD CONSTRAINT `carrier_otp_challenges_carrier_employee_id_fkey` FOREIGN KEY (`carrier_employee_id`) REFERENCES `carrier_employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carrier_settlements` ADD CONSTRAINT `carrier_settlements_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `transport_companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


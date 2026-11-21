-- AlterTable
ALTER TABLE `booking_passengers` ADD COLUMN `gender` ENUM('MALE', 'FEMALE') NULL,
    MODIFY `phone` VARCHAR(32) NULL;

-- AlterTable
ALTER TABLE `bookings` ADD COLUMN `booking_ref` VARCHAR(32) NULL,
    ADD COLUMN `change_count` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `channel` ENUM('BROKER', 'DIRECT') NOT NULL DEFAULT 'BROKER',
    ADD COLUMN `customer_id` VARCHAR(191) NULL,
    ADD COLUMN `discount_amount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `group_id` VARCHAR(191) NULL,
    ADD COLUMN `leg` ENUM('OUTBOUND', 'RETURN') NULL,
    ADD COLUMN `payment_method` ENUM('WALLET', 'ONLINE', 'CASH_ON_BOARD') NOT NULL DEFAULT 'WALLET',
    ADD COLUMN `payment_status` ENUM('PENDING', 'PAID', 'UNPAID_CASH', 'PAID_CASH', 'REFUNDED', 'PARTIALLY_REFUNDED') NOT NULL DEFAULT 'PAID',
    ADD COLUMN `subtotal_amount` INTEGER NULL,
    ADD COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    MODIFY `office_id` VARCHAR(191) NULL,
    MODIFY `employee_id` VARCHAR(191) NULL,
    MODIFY `status` ENUM('CONFIRMED', 'CANCELLED', 'PENDING_PAYMENT', 'CHANGED', 'EXPIRED') NOT NULL DEFAULT 'CONFIRMED',
    MODIFY `confirmed_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `seat_holds` ADD COLUMN `customer_id` VARCHAR(191) NULL,
    MODIFY `office_id` VARCHAR(191) NULL,
    MODIFY `employee_id` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `tickets` ADD COLUMN `boarded_at` DATETIME(3) NULL,
    ADD COLUMN `boarded_by_driver_id` VARCHAR(191) NULL,
    ADD COLUMN `boarding_method` ENUM('QR', 'MANUAL') NULL,
    ADD COLUMN `boarding_status` ENUM('PENDING', 'BOARDED', 'NO_SHOW') NOT NULL DEFAULT 'PENDING',
    MODIFY `status` ENUM('CONFIRMED', 'CANCELLED', 'CHANGED') NOT NULL DEFAULT 'CONFIRMED';

-- AlterTable
ALTER TABLE `transport_companies` ADD COLUMN `cash_enabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `legal_name` VARCHAR(200) NULL,
    ADD COLUMN `logo_url` VARCHAR(512) NULL,
    ADD COLUMN `rating_avg_x100` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `rating_count` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `short_name` VARCHAR(80) NULL,
    ADD COLUMN `suspended_at` DATETIME(3) NULL,
    ADD COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `trip_seats` ADD COLUMN `is_women_only` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `layout_column` INTEGER NULL,
    ADD COLUMN `layout_row` INTEGER NULL;

-- AlterTable
ALTER TABLE `trips` ADD COLUMN `arrival_at` DATETIME(3) NULL,
    ADD COLUMN `cancelled_at` DATETIME(3) NULL,
    ADD COLUMN `completed_at` DATETIME(3) NULL,
    ADD COLUMN `destination_station_id` VARCHAR(191) NULL,
    ADD COLUMN `driver_id` VARCHAR(191) NULL,
    ADD COLUMN `origin_station_id` VARCHAR(191) NULL,
    ADD COLUMN `route_id` VARCHAR(191) NULL,
    ADD COLUMN `service_class` ENUM('STANDARD', 'VIP') NOT NULL DEFAULT 'STANDARD',
    ADD COLUMN `started_at` DATETIME(3) NULL,
    ADD COLUMN `status` ENUM('SCHEDULED', 'BOARDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
    ADD COLUMN `trip_number` VARCHAR(32) NULL,
    ADD COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `vehicle_id` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `customers` (
    `id` VARCHAR(191) NOT NULL,
    `display_name` VARCHAR(160) NULL,
    `email` VARCHAR(191) NULL,
    `avatar_url` VARCHAR(512) NULL,
    `preferred_language` VARCHAR(8) NOT NULL DEFAULT 'ar',
    `trip_alerts_enabled` BOOLEAN NOT NULL DEFAULT true,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'DELETED') NOT NULL DEFAULT 'ACTIVE',
    `cash_no_show_count` INTEGER NOT NULL DEFAULT 0,
    `authz_version` INTEGER NOT NULL DEFAULT 1,
    `last_login_at` DATETIME(3) NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `customers_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_identities` (
    `id` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NOT NULL,
    `type` ENUM('PHONE', 'EMAIL') NOT NULL,
    `value_normalized` VARCHAR(191) NOT NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT true,
    `verified_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `customer_identities_customer_id_idx`(`customer_id`),
    UNIQUE INDEX `customer_identities_type_value_normalized_key`(`type`, `value_normalized`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_refresh_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NOT NULL,
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

    UNIQUE INDEX `customer_refresh_sessions_token_hash_key`(`token_hash`),
    INDEX `customer_refresh_sessions_customer_id_revoked_at_idx`(`customer_id`, `revoked_at`),
    INDEX `customer_refresh_sessions_family_id_idx`(`family_id`),
    INDEX `customer_refresh_sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_otp_challenges` (
    `id` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NULL,
    `identity_type` ENUM('PHONE', 'EMAIL') NOT NULL,
    `identity_value` VARCHAR(191) NOT NULL,
    `purpose` ENUM('CUSTOMER_LOGIN', 'CUSTOMER_PHONE_CHANGE') NOT NULL,
    `code_hash` VARCHAR(128) NOT NULL,
    `status` ENUM('PENDING', 'CONSUMED', 'EXPIRED', 'LOCKED') NOT NULL DEFAULT 'PENDING',
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `max_attempts` INTEGER NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `consumed_at` DATETIME(3) NULL,
    `request_id` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `customer_otp_challenges_identity_value_purpose_status_idx`(`identity_value`, `purpose`, `status`),
    INDEX `customer_otp_challenges_customer_id_purpose_status_idx`(`customer_id`, `purpose`, `status`),
    INDEX `customer_otp_challenges_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recent_searches` (
    `id` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NOT NULL,
    `from_city_id` VARCHAR(191) NOT NULL,
    `to_city_id` VARCHAR(191) NOT NULL,
    `travel_date` CHAR(10) NOT NULL,
    `return_date` CHAR(10) NULL,
    `passengers` INTEGER NOT NULL DEFAULT 1,
    `searched_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recent_searches_customer_id_searched_at_idx`(`customer_id`, `searched_at`),
    UNIQUE INDEX `recent_searches_customer_id_from_city_id_to_city_id_key`(`customer_id`, `from_city_id`, `to_city_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `drivers` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `driver_code` VARCHAR(32) NOT NULL,
    `display_name` VARCHAR(160) NOT NULL,
    `avatar_url` VARCHAR(512) NULL,
    `license_number` VARCHAR(64) NULL,
    `license_expiry` DATE NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `authz_version` INTEGER NOT NULL DEFAULT 1,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `drivers_driver_code_key`(`driver_code`),
    INDEX `drivers_company_id_status_idx`(`company_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `driver_identities` (
    `id` VARCHAR(191) NOT NULL,
    `driver_id` VARCHAR(191) NOT NULL,
    `type` ENUM('PHONE', 'EMAIL') NOT NULL,
    `value_normalized` VARCHAR(191) NOT NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT true,
    `verified_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `driver_identities_driver_id_idx`(`driver_id`),
    UNIQUE INDEX `driver_identities_type_value_normalized_key`(`type`, `value_normalized`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `driver_refresh_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `driver_id` VARCHAR(191) NOT NULL,
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

    UNIQUE INDEX `driver_refresh_sessions_token_hash_key`(`token_hash`),
    INDEX `driver_refresh_sessions_driver_id_revoked_at_idx`(`driver_id`, `revoked_at`),
    INDEX `driver_refresh_sessions_family_id_idx`(`family_id`),
    INDEX `driver_refresh_sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `driver_otp_challenges` (
    `id` VARCHAR(191) NOT NULL,
    `driver_id` VARCHAR(191) NOT NULL,
    `identity_type` ENUM('PHONE', 'EMAIL') NOT NULL,
    `identity_value` VARCHAR(191) NOT NULL,
    `purpose` ENUM('DRIVER_LOGIN') NOT NULL,
    `code_hash` VARCHAR(128) NOT NULL,
    `status` ENUM('PENDING', 'CONSUMED', 'EXPIRED', 'LOCKED') NOT NULL DEFAULT 'PENDING',
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `max_attempts` INTEGER NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `consumed_at` DATETIME(3) NULL,
    `request_id` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `driver_otp_challenges_driver_id_purpose_status_idx`(`driver_id`, `purpose`, `status`),
    INDEX `driver_otp_challenges_identity_value_purpose_status_idx`(`identity_value`, `purpose`, `status`),
    INDEX `driver_otp_challenges_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vehicles` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `plate_number` VARCHAR(32) NOT NULL,
    `model` VARCHAR(120) NOT NULL,
    `capacity` INTEGER NOT NULL,
    `service_class` ENUM('STANDARD', 'VIP') NOT NULL DEFAULT 'STANDARD',
    `seat_layout` JSON NOT NULL,
    `status` ENUM('ACTIVE', 'MAINTENANCE', 'RETIRED') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `vehicles_plate_number_key`(`plate_number`),
    INDEX `vehicles_company_id_status_idx`(`company_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `amenities` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name_ar` VARCHAR(80) NOT NULL,
    `name_en` VARCHAR(80) NOT NULL,
    `icon` VARCHAR(64) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `amenities_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vehicle_amenities` (
    `vehicle_id` VARCHAR(191) NOT NULL,
    `amenity_id` VARCHAR(191) NOT NULL,
    `value` VARCHAR(32) NULL,

    PRIMARY KEY (`vehicle_id`, `amenity_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cities` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(16) NOT NULL,
    `name_ar` VARCHAR(120) NOT NULL,
    `name_en` VARCHAR(120) NOT NULL,
    `image_url` VARCHAR(512) NULL,
    `is_popular` BOOLEAN NOT NULL DEFAULT false,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `cities_code_key`(`code`),
    INDEX `cities_is_active_sort_order_idx`(`is_active`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stations` (
    `id` VARCHAR(191) NOT NULL,
    `city_id` VARCHAR(191) NOT NULL,
    `name_ar` VARCHAR(160) NOT NULL,
    `name_en` VARCHAR(160) NOT NULL,
    `address` VARCHAR(255) NULL,
    `latitude` DECIMAL(9, 6) NULL,
    `longitude` DECIMAL(9, 6) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `stations_city_id_is_active_idx`(`city_id`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `routes` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(32) NULL,
    `origin_station_id` VARCHAR(191) NOT NULL,
    `destination_station_id` VARCHAR(191) NOT NULL,
    `duration_minutes` INTEGER NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `routes_origin_station_id_destination_station_id_idx`(`origin_station_id`, `destination_station_id`),
    UNIQUE INDEX `routes_company_id_code_key`(`company_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `route_stops` (
    `id` VARCHAR(191) NOT NULL,
    `route_id` VARCHAR(191) NOT NULL,
    `station_id` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `offset_minutes` INTEGER NOT NULL,
    `dwell_minutes` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `route_stops_route_id_sequence_key`(`route_id`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trip_stops` (
    `id` VARCHAR(191) NOT NULL,
    `trip_id` VARCHAR(191) NOT NULL,
    `station_id` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `scheduled_arrival_at` DATETIME(3) NULL,
    `scheduled_departure_at` DATETIME(3) NULL,
    `actual_arrival_at` DATETIME(3) NULL,
    `actual_departure_at` DATETIME(3) NULL,

    INDEX `trip_stops_station_id_idx`(`station_id`),
    UNIQUE INDEX `trip_stops_trip_id_sequence_key`(`trip_id`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `boarding_scans` (
    `id` VARCHAR(191) NOT NULL,
    `trip_id` VARCHAR(191) NOT NULL,
    `driver_id` VARCHAR(191) NOT NULL,
    `ticket_id` VARCHAR(191) NULL,
    `method` ENUM('QR', 'MANUAL') NOT NULL,
    `result` ENUM('VALID', 'ALREADY_BOARDED', 'WRONG_TRIP', 'CANCELLED', 'INVALID') NOT NULL,
    `code_hash` CHAR(64) NULL,
    `scanned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `boarding_scans_trip_id_scanned_at_idx`(`trip_id`, `scanned_at`),
    INDEX `boarding_scans_driver_id_scanned_at_idx`(`driver_id`, `scanned_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cash_collections` (
    `id` VARCHAR(191) NOT NULL,
    `ticket_id` VARCHAR(191) NOT NULL,
    `trip_id` VARCHAR(191) NOT NULL,
    `driver_id` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `collected_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `cash_collections_ticket_id_key`(`ticket_id`),
    INDEX `cash_collections_trip_id_idx`(`trip_id`),
    INDEX `cash_collections_driver_id_collected_at_idx`(`driver_id`, `collected_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vehicle_positions` (
    `id` VARCHAR(191) NOT NULL,
    `trip_id` VARCHAR(191) NOT NULL,
    `driver_id` VARCHAR(191) NOT NULL,
    `vehicle_id` VARCHAR(191) NULL,
    `latitude` DECIMAL(9, 6) NOT NULL,
    `longitude` DECIMAL(9, 6) NOT NULL,
    `speed_kmh` INTEGER NULL,
    `heading` INTEGER NULL,
    `recorded_at` DATETIME(3) NOT NULL,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `vehicle_positions_trip_id_recorded_at_idx`(`trip_id`, `recorded_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_intents` (
    `id` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NOT NULL,
    `purpose` ENUM('BOOKING', 'CHANGE_DIFFERENCE') NOT NULL,
    `booking_id` VARCHAR(191) NULL,
    `group_id` VARCHAR(191) NULL,
    `amount` INTEGER NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'SDG',
    `status` ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `provider` VARCHAR(64) NOT NULL DEFAULT 'mock',
    `provider_ref` VARCHAR(191) NULL,
    `provider_event_id` VARCHAR(191) NULL,
    `idempotency_key` VARCHAR(128) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `succeeded_at` DATETIME(3) NULL,
    `failed_at` DATETIME(3) NULL,
    `failure_reason` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payment_intents_provider_event_id_key`(`provider_event_id`),
    UNIQUE INDEX `payment_intents_idempotency_key_key`(`idempotency_key`),
    INDEX `payment_intents_customer_id_created_at_idx`(`customer_id`, `created_at`),
    INDEX `payment_intents_status_expires_at_idx`(`status`, `expires_at`),
    INDEX `payment_intents_booking_id_idx`(`booking_id`),
    INDEX `payment_intents_group_id_idx`(`group_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refunds` (
    `id` VARCHAR(191) NOT NULL,
    `booking_id` VARCHAR(191) NOT NULL,
    `payment_intent_id` VARCHAR(191) NULL,
    `amount` INTEGER NOT NULL,
    `reason` ENUM('CUSTOMER_CANCEL', 'CARRIER_CANCEL', 'CHANGE_DIFFERENCE', 'ADMIN') NOT NULL,
    `status` ENUM('PENDING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `provider_ref` VARCHAR(191) NULL,
    `idempotency_key` VARCHAR(128) NOT NULL,
    `processed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refunds_idempotency_key_key`(`idempotency_key`),
    INDEX `refunds_booking_id_idx`(`booking_id`),
    INDEX `refunds_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_settings` (
    `key` VARCHAR(96) NOT NULL,
    `value` JSON NOT NULL,
    `updated_by_admin_id` VARCHAR(191) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_pages` (
    `slug` VARCHAR(64) NOT NULL,
    `title_ar` VARCHAR(160) NOT NULL,
    `title_en` VARCHAR(160) NOT NULL,
    `sections` JSON NOT NULL,
    `published_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`slug`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `device_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `principal_type` ENUM('CUSTOMER', 'DRIVER', 'BROKER_EMPLOYEE', 'ADMIN') NOT NULL,
    `principal_id` VARCHAR(64) NOT NULL,
    `platform` ENUM('IOS', 'ANDROID', 'WEB') NOT NULL,
    `token` VARCHAR(512) NOT NULL,
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `device_tokens_token_key`(`token`),
    INDEX `device_tokens_principal_type_principal_id_idx`(`principal_type`, `principal_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `recipient_type` ENUM('CUSTOMER', 'DRIVER', 'BROKER_EMPLOYEE', 'ADMIN') NOT NULL,
    `recipient_id` VARCHAR(64) NOT NULL,
    `type` VARCHAR(48) NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `body` VARCHAR(1000) NOT NULL,
    `data` JSON NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_recipient_type_recipient_id_created_at_idx`(`recipient_type`, `recipient_id`, `created_at`),
    INDEX `notifications_recipient_type_recipient_id_read_at_idx`(`recipient_type`, `recipient_id`, `read_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `booking_groups` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('ROUND_TRIP') NOT NULL,
    `channel` ENUM('BROKER', 'DIRECT') NOT NULL,
    `customer_id` VARCHAR(191) NULL,
    `office_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `booking_groups_customer_id_created_at_idx`(`customer_id`, `created_at`),
    INDEX `booking_groups_office_id_created_at_idx`(`office_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `booking_changes` (
    `id` VARCHAR(191) NOT NULL,
    `kind` ENUM('SEAT', 'TRIP') NOT NULL,
    `booking_id` VARCHAR(191) NOT NULL,
    `new_booking_id` VARCHAR(191) NULL,
    `from_seat_label` VARCHAR(32) NULL,
    `to_seat_label` VARCHAR(32) NULL,
    `price_difference_amount` INTEGER NOT NULL DEFAULT 0,
    `change_fee_amount` INTEGER NOT NULL DEFAULT 0,
    `actor_type` VARCHAR(32) NOT NULL,
    `actor_id` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `booking_changes_new_booking_id_key`(`new_booking_id`),
    INDEX `booking_changes_booking_id_created_at_idx`(`booking_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coupons` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `discount_type` ENUM('PERCENT', 'FIXED') NOT NULL,
    `value` INTEGER NOT NULL,
    `max_discount_amount` INTEGER NULL,
    `min_subtotal_amount` INTEGER NULL,
    `company_id` VARCHAR(191) NULL,
    `valid_from` DATETIME(3) NOT NULL,
    `valid_to` DATETIME(3) NOT NULL,
    `max_redemptions` INTEGER NULL,
    `per_customer_limit` INTEGER NOT NULL DEFAULT 1,
    `redeemed_count` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `coupons_code_key`(`code`),
    INDEX `coupons_is_active_valid_from_valid_to_idx`(`is_active`, `valid_from`, `valid_to`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coupon_redemptions` (
    `id` VARCHAR(191) NOT NULL,
    `coupon_id` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NOT NULL,
    `booking_id` VARCHAR(191) NOT NULL,
    `discount_amount` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `coupon_redemptions_booking_id_key`(`booking_id`),
    INDEX `coupon_redemptions_coupon_id_customer_id_idx`(`coupon_id`, `customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `carrier_ratings` (
    `id` VARCHAR(191) NOT NULL,
    `booking_id` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `stars` TINYINT NOT NULL,
    `comment` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `carrier_ratings_booking_id_key`(`booking_id`),
    INDEX `carrier_ratings_company_id_created_at_idx`(`company_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `bookings_booking_ref_key` ON `bookings`(`booking_ref`);

-- CreateIndex
CREATE INDEX `bookings_customer_id_created_at_idx` ON `bookings`(`customer_id`, `created_at`);

-- CreateIndex
CREATE INDEX `bookings_group_id_idx` ON `bookings`(`group_id`);

-- CreateIndex
CREATE INDEX `bookings_channel_status_idx` ON `bookings`(`channel`, `status`);

-- CreateIndex
CREATE INDEX `seat_holds_customer_id_idx` ON `seat_holds`(`customer_id`);

-- CreateIndex
CREATE UNIQUE INDEX `trips_trip_number_key` ON `trips`(`trip_number`);

-- CreateIndex
CREATE INDEX `trips_origin_station_id_destination_station_id_departure_at_idx` ON `trips`(`origin_station_id`, `destination_station_id`, `departure_at`);

-- CreateIndex
CREATE INDEX `trips_driver_id_departure_at_idx` ON `trips`(`driver_id`, `departure_at`);

-- CreateIndex
CREATE INDEX `trips_status_departure_at_idx` ON `trips`(`status`, `departure_at`);

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `booking_groups`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_boarded_by_driver_id_fkey` FOREIGN KEY (`boarded_by_driver_id`) REFERENCES `drivers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trips` ADD CONSTRAINT `trips_route_id_fkey` FOREIGN KEY (`route_id`) REFERENCES `routes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trips` ADD CONSTRAINT `trips_origin_station_id_fkey` FOREIGN KEY (`origin_station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trips` ADD CONSTRAINT `trips_destination_station_id_fkey` FOREIGN KEY (`destination_station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trips` ADD CONSTRAINT `trips_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trips` ADD CONSTRAINT `trips_driver_id_fkey` FOREIGN KEY (`driver_id`) REFERENCES `drivers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seat_holds` ADD CONSTRAINT `seat_holds_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_identities` ADD CONSTRAINT `customer_identities_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_refresh_sessions` ADD CONSTRAINT `customer_refresh_sessions_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_otp_challenges` ADD CONSTRAINT `customer_otp_challenges_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recent_searches` ADD CONSTRAINT `recent_searches_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recent_searches` ADD CONSTRAINT `recent_searches_from_city_id_fkey` FOREIGN KEY (`from_city_id`) REFERENCES `cities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recent_searches` ADD CONSTRAINT `recent_searches_to_city_id_fkey` FOREIGN KEY (`to_city_id`) REFERENCES `cities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `drivers` ADD CONSTRAINT `drivers_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `transport_companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `driver_identities` ADD CONSTRAINT `driver_identities_driver_id_fkey` FOREIGN KEY (`driver_id`) REFERENCES `drivers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `driver_refresh_sessions` ADD CONSTRAINT `driver_refresh_sessions_driver_id_fkey` FOREIGN KEY (`driver_id`) REFERENCES `drivers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `driver_otp_challenges` ADD CONSTRAINT `driver_otp_challenges_driver_id_fkey` FOREIGN KEY (`driver_id`) REFERENCES `drivers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vehicles` ADD CONSTRAINT `vehicles_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `transport_companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vehicle_amenities` ADD CONSTRAINT `vehicle_amenities_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vehicle_amenities` ADD CONSTRAINT `vehicle_amenities_amenity_id_fkey` FOREIGN KEY (`amenity_id`) REFERENCES `amenities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stations` ADD CONSTRAINT `stations_city_id_fkey` FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `routes` ADD CONSTRAINT `routes_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `transport_companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `routes` ADD CONSTRAINT `routes_origin_station_id_fkey` FOREIGN KEY (`origin_station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `routes` ADD CONSTRAINT `routes_destination_station_id_fkey` FOREIGN KEY (`destination_station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `route_stops` ADD CONSTRAINT `route_stops_route_id_fkey` FOREIGN KEY (`route_id`) REFERENCES `routes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `route_stops` ADD CONSTRAINT `route_stops_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trip_stops` ADD CONSTRAINT `trip_stops_trip_id_fkey` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trip_stops` ADD CONSTRAINT `trip_stops_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `boarding_scans` ADD CONSTRAINT `boarding_scans_trip_id_fkey` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `boarding_scans` ADD CONSTRAINT `boarding_scans_driver_id_fkey` FOREIGN KEY (`driver_id`) REFERENCES `drivers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `boarding_scans` ADD CONSTRAINT `boarding_scans_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_collections` ADD CONSTRAINT `cash_collections_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_collections` ADD CONSTRAINT `cash_collections_trip_id_fkey` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_collections` ADD CONSTRAINT `cash_collections_driver_id_fkey` FOREIGN KEY (`driver_id`) REFERENCES `drivers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vehicle_positions` ADD CONSTRAINT `vehicle_positions_trip_id_fkey` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vehicle_positions` ADD CONSTRAINT `vehicle_positions_driver_id_fkey` FOREIGN KEY (`driver_id`) REFERENCES `drivers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vehicle_positions` ADD CONSTRAINT `vehicle_positions_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_intents` ADD CONSTRAINT `payment_intents_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_intents` ADD CONSTRAINT `payment_intents_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_intents` ADD CONSTRAINT `payment_intents_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `booking_groups`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_payment_intent_id_fkey` FOREIGN KEY (`payment_intent_id`) REFERENCES `payment_intents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `system_settings` ADD CONSTRAINT `system_settings_updated_by_admin_id_fkey` FOREIGN KEY (`updated_by_admin_id`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `booking_groups` ADD CONSTRAINT `booking_groups_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `booking_groups` ADD CONSTRAINT `booking_groups_office_id_fkey` FOREIGN KEY (`office_id`) REFERENCES `broker_offices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `booking_changes` ADD CONSTRAINT `booking_changes_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `booking_changes` ADD CONSTRAINT `booking_changes_new_booking_id_fkey` FOREIGN KEY (`new_booking_id`) REFERENCES `bookings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupons` ADD CONSTRAINT `coupons_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `transport_companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupon_redemptions` ADD CONSTRAINT `coupon_redemptions_coupon_id_fkey` FOREIGN KEY (`coupon_id`) REFERENCES `coupons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupon_redemptions` ADD CONSTRAINT `coupon_redemptions_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupon_redemptions` ADD CONSTRAINT `coupon_redemptions_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carrier_ratings` ADD CONSTRAINT `carrier_ratings_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carrier_ratings` ADD CONSTRAINT `carrier_ratings_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carrier_ratings` ADD CONSTRAINT `carrier_ratings_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `transport_companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE `coupons` ADD COLUMN `promo_image_url` VARCHAR(500) NULL,
    ADD COLUMN `promo_sort_order` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `promo_subtitle_ar` VARCHAR(200) NULL,
    ADD COLUMN `promo_title_ar` VARCHAR(120) NULL,
    ADD COLUMN `show_in_app` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `customer_favorite_trips` (
    `id` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NOT NULL,
    `trip_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `customer_favorite_trips_customer_id_created_at_idx`(`customer_id`, `created_at`),
    UNIQUE INDEX `customer_favorite_trips_customer_id_trip_id_key`(`customer_id`, `trip_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `customer_favorite_trips` ADD CONSTRAINT `customer_favorite_trips_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_favorite_trips` ADD CONSTRAINT `customer_favorite_trips_trip_id_fkey` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `ticket_dispatch_attempts` (
    `id` VARCHAR(191) NOT NULL,
    `booking_id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `channel` ENUM('DOWNLOAD', 'WHATSAPP', 'SMS') NOT NULL,
    `status` ENUM('READY', 'RECORDED') NOT NULL,
    `payload_json` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ticket_dispatch_attempts_booking_id_created_at_idx`(`booking_id`, `created_at`),
    INDEX `ticket_dispatch_attempts_employee_id_created_at_idx`(`employee_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ticket_dispatch_attempts` ADD CONSTRAINT `ticket_dispatch_attempts_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_dispatch_attempts` ADD CONSTRAINT `ticket_dispatch_attempts_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `broker_employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

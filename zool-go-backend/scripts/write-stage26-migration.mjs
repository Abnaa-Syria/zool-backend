import { mkdirSync, writeFileSync } from 'node:fs';

const dir = 'prisma/migrations/20261023210000_stage2_6_policy_locks';
mkdirSync(dir, { recursive: true });

const sql = `-- Stage 2.6 policy locks

ALTER TABLE \`broker_offices\` CHANGE \`min_top_up_override\` \`min_top_up_minor_override\` INTEGER NULL;
ALTER TABLE \`broker_offices\` ADD COLUMN \`low_balance_threshold_minor_override\` INTEGER NULL;
ALTER TABLE \`broker_offices\` ADD COLUMN \`time_zone\` VARCHAR(64) NULL;

ALTER TABLE \`trip_seats\` ADD COLUMN \`sort_order\` INTEGER NOT NULL DEFAULT 0;
CREATE INDEX \`trip_seats_trip_id_sort_order_idx\` ON \`trip_seats\`(\`trip_id\`, \`sort_order\`);

ALTER TABLE \`top_up_intents\`
  MODIFY \`status\` ENUM('PENDING', 'PENDING_REVIEW', 'CONFIRMED', 'FAILED') NOT NULL DEFAULT 'PENDING';
ALTER TABLE \`top_up_intents\` ADD COLUMN \`confirmation_path\` ENUM('AUTOMATIC', 'MANUAL_FALLBACK') NOT NULL DEFAULT 'AUTOMATIC';
ALTER TABLE \`top_up_intents\` ADD COLUMN \`provider_event_id\` VARCHAR(191) NULL;
ALTER TABLE \`top_up_intents\` ADD COLUMN \`payment_reference_normalized\` VARCHAR(128) NULL;
ALTER TABLE \`top_up_intents\` ADD COLUMN \`parent_intent_id\` VARCHAR(191) NULL;
ALTER TABLE \`top_up_intents\` ADD COLUMN \`failed_at\` DATETIME(3) NULL;
ALTER TABLE \`top_up_intents\` ADD COLUMN \`reviewed_by_admin_id\` VARCHAR(191) NULL;
ALTER TABLE \`top_up_intents\` ADD COLUMN \`review_note\` VARCHAR(500) NULL;
ALTER TABLE \`top_up_intents\` ADD COLUMN \`created_by_admin_id\` VARCHAR(191) NULL;
CREATE UNIQUE INDEX \`top_up_intents_provider_event_id_key\` ON \`top_up_intents\`(\`provider_event_id\`);
CREATE UNIQUE INDEX \`top_up_intents_provider_payment_reference_normalized_key\` ON \`top_up_intents\`(\`provider\`, \`payment_reference_normalized\`);
ALTER TABLE \`top_up_intents\` ADD CONSTRAINT \`top_up_intents_parent_intent_id_fkey\` FOREIGN KEY (\`parent_intent_id\`) REFERENCES \`top_up_intents\`(\`id\`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE \`top_up_intents\` ADD CONSTRAINT \`top_up_intents_reviewed_by_admin_id_fkey\` FOREIGN KEY (\`reviewed_by_admin_id\`) REFERENCES \`admin_users\`(\`id\`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE \`top_up_intents\` ADD CONSTRAINT \`top_up_intents_created_by_admin_id_fkey\` FOREIGN KEY (\`created_by_admin_id\`) REFERENCES \`admin_users\`(\`id\`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE \`top_up_evidence\` (
    \`id\` VARCHAR(191) NOT NULL,
    \`intent_id\` VARCHAR(191) NOT NULL,
    \`storage_key\` VARCHAR(255) NOT NULL,
    \`original_name\` VARCHAR(255) NOT NULL,
    \`mime_type\` VARCHAR(64) NOT NULL,
    \`size_bytes\` INTEGER NOT NULL,
    \`checksum_sha256\` CHAR(64) NOT NULL,
    \`uploaded_by_admin_id\` VARCHAR(191) NULL,
    \`uploaded_by_employee_id\` VARCHAR(191) NULL,
    \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX \`top_up_evidence_intent_id_idx\`(\`intent_id\`),
    PRIMARY KEY (\`id\`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE \`top_up_evidence\` ADD CONSTRAINT \`top_up_evidence_intent_id_fkey\` FOREIGN KEY (\`intent_id\`) REFERENCES \`top_up_intents\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE \`top_up_evidence\` ADD CONSTRAINT \`top_up_evidence_uploaded_by_admin_id_fkey\` FOREIGN KEY (\`uploaded_by_admin_id\`) REFERENCES \`admin_users\`(\`id\`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE \`top_up_evidence\` ADD CONSTRAINT \`top_up_evidence_uploaded_by_employee_id_fkey\` FOREIGN KEY (\`uploaded_by_employee_id\`) REFERENCES \`broker_employees\`(\`id\`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE \`commission_accruals\`
  MODIFY \`status\` ENUM('UNSETTLED', 'RESERVED', 'SETTLED', 'CLAWED_BACK') NOT NULL DEFAULT 'UNSETTLED';
ALTER TABLE \`commission_accruals\` ADD COLUMN \`settlement_id\` VARCHAR(191) NULL;

CREATE TABLE \`commission_settlements\` (
    \`id\` VARCHAR(191) NOT NULL,
    \`office_id\` VARCHAR(191) NOT NULL,
    \`period_from\` DATETIME(3) NOT NULL,
    \`period_to\` DATETIME(3) NOT NULL,
    \`status\` ENUM('DRAFT', 'FINALIZED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    \`total_amount\` INTEGER NOT NULL,
    \`initiated_by_admin_id\` VARCHAR(191) NOT NULL,
    \`finalized_by_admin_id\` VARCHAR(191) NULL,
    \`note\` VARCHAR(500) NULL,
    \`payout_reference\` VARCHAR(128) NULL,
    \`finalized_at\` DATETIME(3) NULL,
    \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    \`updated_at\` DATETIME(3) NOT NULL,
    INDEX \`commission_settlements_office_id_status_idx\`(\`office_id\`, \`status\`),
    INDEX \`commission_settlements_office_id_period_from_period_to_idx\`(\`office_id\`, \`period_from\`, \`period_to\`),
    PRIMARY KEY (\`id\`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE \`commission_settlements\` ADD CONSTRAINT \`commission_settlements_office_id_fkey\` FOREIGN KEY (\`office_id\`) REFERENCES \`broker_offices\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE \`commission_settlements\` ADD CONSTRAINT \`commission_settlements_initiated_by_admin_id_fkey\` FOREIGN KEY (\`initiated_by_admin_id\`) REFERENCES \`admin_users\`(\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE \`commission_settlements\` ADD CONSTRAINT \`commission_settlements_finalized_by_admin_id_fkey\` FOREIGN KEY (\`finalized_by_admin_id\`) REFERENCES \`admin_users\`(\`id\`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX \`commission_accruals_settlement_id_idx\` ON \`commission_accruals\`(\`settlement_id\`);
ALTER TABLE \`commission_accruals\` ADD CONSTRAINT \`commission_accruals_settlement_id_fkey\` FOREIGN KEY (\`settlement_id\`) REFERENCES \`commission_settlements\`(\`id\`) ON DELETE SET NULL ON UPDATE CASCADE;
`;

writeFileSync(`${dir}/migration.sql`, sql, { encoding: 'utf8' });
console.log('wrote', dir);

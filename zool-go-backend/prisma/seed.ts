import {
  AdminStatus,
  BrokerEmployeeRole,
  BrokerEmployeeStatus,
  BrokerOfficeStatus,
  IdentityType,
  PrismaClient,
  SettlementPeriod,
} from '@prisma/client';
import { PERMISSION_CATALOG, SUPER_ADMIN_ROLE_KEY } from '../src/shared/constants/permissions';
import { normalizePhone } from '../src/shared/utils/phone';
import { seedPhase2 } from './seed-phase2';

const prisma = new PrismaClient();

const SEED_SEAT_LABELS = Array.from({ length: 10 }, (_, i) => `A${i + 1}`);

async function ensureBrokerEmployee(input: {
  officeId: string;
  phone: string;
  displayName: string;
  role: BrokerEmployeeRole;
  canBook: boolean;
  canTopUp: boolean;
  canViewReports: boolean;
  canManageStaff: boolean;
}) {
  const phone = normalizePhone(input.phone);
  const existing = await prisma.brokerIdentity.findUnique({
    where: { type_valueNormalized: { type: IdentityType.PHONE, valueNormalized: phone } },
    include: { brokerEmployee: true },
  });
  if (existing) return existing.brokerEmployee;

  return prisma.brokerEmployee.create({
    data: {
      officeId: input.officeId,
      displayName: input.displayName,
      role: input.role,
      status: BrokerEmployeeStatus.ACTIVE,
      canBook: input.canBook,
      canTopUp: input.canTopUp,
      canViewReports: input.canViewReports,
      canManageStaff: input.canManageStaff,
      identities: {
        create: {
          type: IdentityType.PHONE,
          valueNormalized: phone,
          isPrimary: true,
          verifiedAt: new Date(),
        },
      },
    },
  });
}

/** Stage 2 demo data: carrier, broker office + wallet + staff, assignment, tomorrow's trips. */
async function seedStage2() {
  const company = await prisma.transportCompany.upsert({
    where: { key: 'sudan_express' },
    create: { key: 'sudan_express', name: 'Sudan Express' },
    update: {},
  });

  const office = await prisma.brokerOffice.upsert({
    where: { code: 'ZG-BRK-1' },
    create: {
      code: 'ZG-BRK-1',
      name: 'مكتب زول قو - الخرطوم',
      status: BrokerOfficeStatus.ACTIVE,
      settlementPeriod: SettlementPeriod.MONTHLY,
    },
    update: {},
  });

  await prisma.wallet.upsert({
    where: { brokerOfficeId: office.id },
    create: { brokerOfficeId: office.id, balance: 0 },
    update: {},
  });

  const managerPhone = '+249900000101';
  const clerkPhone = '+249900000102';

  await ensureBrokerEmployee({
    officeId: office.id,
    phone: managerPhone,
    displayName: 'محمد عبد الله',
    role: BrokerEmployeeRole.MANAGER,
    canBook: true,
    canTopUp: true,
    canViewReports: true,
    canManageStaff: true,
  });

  await ensureBrokerEmployee({
    officeId: office.id,
    phone: clerkPhone,
    displayName: 'سارة أحمد',
    role: BrokerEmployeeRole.CLERK,
    canBook: true,
    canTopUp: false,
    canViewReports: false,
    canManageStaff: false,
  });

  await prisma.brokerCarrierAssignment.upsert({
    where: { officeId_companyId: { officeId: office.id, companyId: company.id } },
    create: { officeId: office.id, companyId: company.id, commissionPercent: 10 },
    update: { commissionPercent: 10 },
  });

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const dayStart = new Date(
    Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate()),
  );
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const trips = [
    { origin: 'Khartoum', destination: 'Port Sudan', hour: 8, basePrice: 25000 },
    { origin: 'Khartoum', destination: 'Kassala', hour: 14, basePrice: 18000 },
  ];

  for (const spec of trips) {
    const exists = await prisma.trip.findFirst({
      where: {
        companyId: company.id,
        origin: spec.origin,
        destination: spec.destination,
        departureAt: { gte: dayStart, lt: dayEnd },
      },
    });
    if (exists) continue;

    const trip = await prisma.trip.create({
      data: {
        companyId: company.id,
        origin: spec.origin,
        destination: spec.destination,
        departureAt: new Date(dayStart.getTime() + spec.hour * 60 * 60 * 1000),
        basePrice: spec.basePrice,
      },
    });
    await prisma.tripSeat.createMany({
      data: SEED_SEAT_LABELS.map((seatLabel) => ({ tripId: trip.id, seatLabel })),
    });
  }

  // eslint-disable-next-line no-console
  console.log(`Stage 2 seed: office ${office.code}, manager ${managerPhone}, clerk ${clerkPhone}`);
}

async function main() {
  const phoneRaw = process.env.BOOTSTRAP_SUPER_ADMIN_PHONE ?? '+249900000001';
  const displayName = process.env.BOOTSTRAP_SUPER_ADMIN_DISPLAY_NAME ?? 'Super Admin';
  const employeeCode = process.env.BOOTSTRAP_SUPER_ADMIN_EMPLOYEE_CODE ?? 'ZG-EMP-BOOTSTRAP';
  const phone = normalizePhone(phoneRaw);

  for (const permission of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      create: {
        key: permission.key,
        module: permission.module,
        description: permission.description,
      },
      update: {
        module: permission.module,
        description: permission.description,
      },
    });
  }

  const allPermissions = await prisma.permission.findMany();

  const superAdminRole = await prisma.role.upsert({
    where: { key: SUPER_ADMIN_ROLE_KEY },
    create: {
      key: SUPER_ADMIN_ROLE_KEY,
      name: 'Super Admin',
      description: 'Bootstrap governance role with full Stage 1 catalog permissions',
      isSystem: true,
      isActive: true,
    },
    update: {
      isSystem: true,
      isActive: true,
    },
  });

  await prisma.rolePermission.deleteMany({ where: { roleId: superAdminRole.id } });
  await prisma.rolePermission.createMany({
    data: allPermissions.map((p) => ({
      roleId: superAdminRole.id,
      permissionId: p.id,
    })),
  });

  let admin = await prisma.adminUser.findFirst({
    where: { isBootstrap: true },
    include: { identities: true },
  });

  if (!admin) {
    admin = await prisma.adminUser.create({
      data: {
        employeeCode,
        displayName,
        status: AdminStatus.ACTIVE,
        isBootstrap: true,
        identities: {
          create: {
            type: IdentityType.PHONE,
            valueNormalized: phone,
            isPrimary: true,
            verifiedAt: new Date(),
          },
        },
        userRoles: {
          create: {
            roleId: superAdminRole.id,
            assignedBy: 'seed',
          },
        },
      },
      include: { identities: true },
    });
  } else {
    await prisma.userRole.upsert({
      where: {
        adminUserId_roleId: {
          adminUserId: admin.id,
          roleId: superAdminRole.id,
        },
      },
      create: {
        adminUserId: admin.id,
        roleId: superAdminRole.id,
        assignedBy: 'seed',
      },
      update: { isActive: true },
    });
  }

  await seedStage2();
  await seedPhase2(prisma);

  // eslint-disable-next-line no-console
  console.log('Seed complete');
  // eslint-disable-next-line no-console
  console.log(`Bootstrap Super Admin phone: ${phone}`);
  // eslint-disable-next-line no-console
  console.log(`Bootstrap Super Admin id: ${admin.id}`);
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { PERMISSION_CATALOG } from '../../shared/constants/permissions';
import { getPrisma } from '../../infrastructure/database/prisma';

export class PermissionsService {
  listCatalog() {
    return PERMISSION_CATALOG.map((p) => ({ ...p }));
  }

  async listFromDb() {
    const rows = await getPrisma().permission.findMany({ orderBy: [{ module: 'asc' }, { key: 'asc' }] });
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      module: r.module,
      description: r.description,
    }));
  }
}

export const permissionsService = new PermissionsService();

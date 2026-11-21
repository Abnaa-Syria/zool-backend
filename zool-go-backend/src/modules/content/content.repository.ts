import type { Prisma } from '@prisma/client';
import { getPrisma } from '../../infrastructure/database/prisma';

export class ContentRepository {
  list() {
    return getPrisma().contentPage.findMany({ orderBy: { slug: 'asc' } });
  }

  findBySlug(slug: string) {
    return getPrisma().contentPage.findUnique({ where: { slug } });
  }

  upsert(slug: string, data: Omit<Prisma.ContentPageCreateInput, 'slug'>) {
    return getPrisma().contentPage.upsert({ where: { slug }, create: { slug, ...data }, update: data });
  }
}

export const contentRepository = new ContentRepository();

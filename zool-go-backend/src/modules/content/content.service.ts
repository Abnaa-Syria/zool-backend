import type { ContentPage, Prisma } from '@prisma/client';
import { contentRepository } from './content.repository';
import { AppError } from '../../shared/errors/app-error';
import { auditService } from '../audit/audit.service';

export type ContentSection = { titleAr: string; titleEn: string; bodyAr: string; bodyEn: string };

function toDto(p: ContentPage) {
  return {
    slug: p.slug,
    titleAr: p.titleAr,
    titleEn: p.titleEn,
    sections: p.sections as ContentSection[],
    publishedAt: p.publishedAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/** Static pages served to the apps (privacy, terms, help). */
export class ContentService {
  async list() {
    return (await contentRepository.list()).map(toDto);
  }

  async get(slug: string) {
    const page = await contentRepository.findBySlug(slug);
    if (!page) throw AppError.notFound('Content page not found');
    return toDto(page);
  }

  async upsert(input: {
    slug: string;
    titleAr: string;
    titleEn: string;
    sections: ContentSection[];
    actorAdminId: string;
    requestId?: string;
  }) {
    const data = {
      titleAr: input.titleAr,
      titleEn: input.titleEn,
      sections: input.sections as unknown as Prisma.InputJsonValue,
      publishedAt: new Date(),
    };
    const page = await contentRepository.upsert(input.slug, data);
    await auditService.record({
      actorAdminId: input.actorAdminId,
      action: 'content.published',
      resourceType: 'content_page',
      resourceId: page.slug,
      requestId: input.requestId,
      metadata: { sections: input.sections.length },
    });
    return toDto(page);
  }
}

export const contentService = new ContentService();

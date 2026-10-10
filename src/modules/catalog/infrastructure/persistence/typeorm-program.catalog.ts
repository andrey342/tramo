import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { In, type SelectQueryBuilder } from 'typeorm';

import { type CursorPage, type PageRequest } from '@shared/application';
import { paginateByCursor } from '@shared/infrastructure/database';

import { type CatalogProgramDto, type ProgramFilter } from '../../application/dto/program.dto';
import { type ProgramCatalog } from '../../application/ports/catalog-ports';
import { type FinancingProduct } from '../../domain';

import { ProgramOrmEntity } from './program.orm-entity';
import { TrainingCenterOrmEntity } from './training-center.orm-entity';

// One query per page, served by ix_catalog_programs_published_created_at_id: keyset pagination on
// (created_at, id) among published programs, and the center names in a second query.
@Injectable()
export class TypeOrmProgramCatalog implements ProgramCatalog {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>) {}

  async list(filter: ProgramFilter, page: PageRequest): Promise<CursorPage<CatalogProgramDto>> {
    const query = this.published();
    if (filter.centerId)
      query.andWhere('program.center_id = :centerId', { centerId: filter.centerId });
    if (filter.modality)
      query.andWhere('program.modality = :modality', { modality: filter.modality });
    if (filter.product === 'installments') query.andWhere('program.installment_terms IS NOT NULL');
    if (filter.product === 'isa') query.andWhere('program.isa_income_share_bps IS NOT NULL');
    if (filter.minPriceCents !== undefined) {
      query.andWhere('program.price_cents >= :minPrice', { minPrice: filter.minPriceCents });
    }
    if (filter.maxPriceCents !== undefined) {
      query.andWhere('program.price_cents <= :maxPrice', { maxPrice: filter.maxPriceCents });
    }
    const result = await paginateByCursor(query, page, {
      sortColumn: 'program.created_at',
      idColumn: 'program.id',
      sortValueOf: (row) => row.createdAt.toISOString(),
      idOf: (row) => row.id,
    });
    return { data: await this.withCenterNames(result.data), nextCursor: result.nextCursor };
  }

  async findPublished(id: string): Promise<CatalogProgramDto | null> {
    const row = await this.published().andWhere('program.id = :id', { id }).getOne();
    return row ? ((await this.withCenterNames([row]))[0] ?? null) : null;
  }

  private published(): SelectQueryBuilder<ProgramOrmEntity> {
    return this.txHost.tx
      .getRepository(ProgramOrmEntity)
      .createQueryBuilder('program')
      .where(`program.status = 'published'`)
      .andWhere(
        `program.center_id IN (SELECT id FROM catalog.training_centers WHERE status = 'active')`,
      );
  }

  private async withCenterNames(rows: readonly ProgramOrmEntity[]): Promise<CatalogProgramDto[]> {
    const centers = await this.txHost.tx.find(TrainingCenterOrmEntity, {
      select: { id: true, name: true },
      where: { id: In([...new Set(rows.map((row) => row.centerId))]) },
    });
    const names = new Map(centers.map((center) => [center.id, center.name]));
    return rows.map((row) => {
      const centerName = names.get(row.centerId);
      // published() only returns programs of existing centers, and centers are never deleted.
      if (centerName === undefined) {
        throw new Error(
          `Program ${row.id} belongs to center ${row.centerId}, which does not exist.`,
        );
      }
      return toCatalogProgram(row, centerName);
    });
  }
}

// Rows map straight to the DTO: the read side does not rebuild aggregates, nor re-run their
// validation, for every program of every page.
function toCatalogProgram(row: ProgramOrmEntity, centerName: string): CatalogProgramDto {
  const installments =
    row.installmentTerms && row.installmentRateBps !== null
      ? { allowedTerms: row.installmentTerms, annualRateBasisPoints: row.installmentRateBps }
      : null;
  const isa =
    row.isaIncomeShareBps !== null &&
    row.isaMinMonthlyIncomeCents !== null &&
    row.isaMaxPayments !== null &&
    row.isaCapMultiplierHundredths !== null &&
    row.isaGraceMonths !== null
      ? {
          incomeShareBasisPoints: row.isaIncomeShareBps,
          minMonthlyIncomeCents: row.isaMinMonthlyIncomeCents,
          maxPayments: row.isaMaxPayments,
          capMultiplierHundredths: row.isaCapMultiplierHundredths,
          graceMonths: row.isaGraceMonths,
        }
      : null;
  const products: FinancingProduct[] = [
    ...(installments ? (['installments'] as const) : []),
    ...(isa ? (['isa'] as const) : []),
  ];
  return {
    id: row.id,
    centerId: row.centerId,
    name: row.name,
    modality: row.modality,
    priceCents: row.priceCents,
    currency: 'EUR',
    durationWeeks: row.durationWeeks,
    startDates: row.startDates,
    employabilityRateBasisPoints: row.employabilityBps,
    avgStartingSalaryCents: row.avgStartingSalaryCents,
    financing: { installments, isa },
    products,
    status: row.status,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    centerName,
  };
}

import { type CursorPage, type PageRequest } from '@shared/application';
import { type NationalId } from '@shared/domain';

import {
  type BureauResult,
  type EmploymentResult,
  type KycResult,
  type ProgramSnapshot,
} from '../../domain';
import { type ApplicationFilter, type ApplicationSummaryDto } from '../dto/application.dto';

export const KYC_PROVIDER = Symbol('KYC_PROVIDER');
export const EMPLOYMENT_HISTORY_PROVIDER = Symbol('EMPLOYMENT_HISTORY_PROVIDER');
export const CREDIT_BUREAU = Symbol('CREDIT_BUREAU');
export const PROGRAM_DIRECTORY = Symbol('PROGRAM_DIRECTORY');
export const STUDENT_DIRECTORY = Symbol('STUDENT_DIRECTORY');
export const APPLICATION_QUERIES = Symbol('APPLICATION_QUERIES');

export interface Applicant {
  readonly nationalId: NationalId;
  readonly dateOfBirth: string;
}

// Identity check (document and selfie, in a real provider).
export interface KycProvider {
  verifyIdentity(applicant: Applicant): Promise<KycResult>;
}

// "Vida laboral": months worked in the last two years and current employment.
export interface EmploymentHistoryProvider {
  fetch(nationalId: NationalId): Promise<EmploymentResult>;
}

// Default registries and a credit score.
export interface CreditBureau {
  check(nationalId: NationalId): Promise<BureauResult>;
}

// Programs belong to the catalog module; origination snapshots the ones open for applications.
export interface ProgramDirectory {
  findOpenProgram(programId: string): Promise<ProgramSnapshot | null>;
}

// Accounts belong to iam; a center starts applications for students it knows by email.
export interface StudentDirectory {
  findStudentId(email: string): Promise<string | null>;
}

// Read side of applications: lists without loading aggregates.
export interface ApplicationQueries {
  list(filter: ApplicationFilter, page: PageRequest): Promise<CursorPage<ApplicationSummaryDto>>;
  // Applications waiting for an analyst, oldest first.
  reviewQueue(page: PageRequest): Promise<CursorPage<ApplicationSummaryDto>>;
}

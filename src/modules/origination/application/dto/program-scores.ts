import { Query } from '@nestjs/cqrs';

export interface ProgramScoresDto {
  readonly scoredApplications: number;
  // The mean score of the program's scored applications, rounded; null when none was scored.
  readonly averageScore: number | null;
}

// Part of the module's public surface: reporting shows how a program's applicants score. A
// score is personal financial data and stays in origination's decision records; only this
// aggregate leaves the module.
export class GetProgramScoresQuery extends Query<ProgramScoresDto> {
  constructor(readonly programId: string) {
    super();
  }
}

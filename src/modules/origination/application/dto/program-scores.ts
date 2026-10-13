import { Query } from '@nestjs/cqrs';

export interface ProgramScoresDto {
  readonly scoredApplications: number;
  // The mean score of the program's scored applications, in bands of 5; null below 10 of them.
  readonly averageScore: number | null;
}

// Part of the module's public surface: reporting shows how a program's applicants score. A
// score is personal financial data and stays in origination's decision records; only this
// aggregate leaves the module, only for a cohort large enough not to reveal anyone's score, and
// in bands coarse enough that a new applicant moves it little (GetProgramScoresHandler).
export class GetProgramScoresQuery extends Query<ProgramScoresDto> {
  constructor(readonly programId: string) {
    super();
  }
}

import { uuidv7 } from 'uuidv7';

import { GetProgramScoresQuery } from '../dto/program-scores';
import { type ApplicationQueries } from '../ports/origination-ports';

import { GetProgramScoresHandler } from './get-program-scores.query';

const queriesAnswering = (scoredApplications: number, averageScore: number | null) =>
  ({
    programScores: () => Promise.resolve({ scoredApplications, averageScore }),
  }) as unknown as ApplicationQueries;

describe('GetProgramScoresHandler', () => {
  // With one scored applicant the mean is their score: nothing is shown below ten.
  it('should give no mean below ten scored applicants', async () => {
    const scores = await new GetProgramScoresHandler(queriesAnswering(9, 73)).execute(
      new GetProgramScoresQuery(uuidv7()),
    );

    expect(scores).toEqual({ scoredApplications: 9, averageScore: null });
  });

  it('should give the mean in bands of five from ten applicants', async () => {
    const handler = (average: number) =>
      new GetProgramScoresHandler(queriesAnswering(10, average)).execute(
        new GetProgramScoresQuery(uuidv7()),
      );

    expect((await handler(72)).averageScore).toBe(70);
    expect((await handler(73)).averageScore).toBe(75);
    expect((await handler(100)).averageScore).toBe(100);
  });
});

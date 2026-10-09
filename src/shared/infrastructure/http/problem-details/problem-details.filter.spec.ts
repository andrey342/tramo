import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  type INestApplication,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Type } from 'class-transformer';
import { IsEmail, IsInt, Min, ValidateNested } from 'class-validator';
import request from 'supertest';

import { InvalidStateTransitionError, InvalidValueError } from '@shared/domain';

import { httpErrorHandlingProviders } from '../testing';

import { PROBLEM_CONTENT_TYPE } from './problem-details';

class AddressDto {
  @IsInt()
  @Min(1)
  number!: number;
}

class SignUpDto {
  @IsEmail()
  email!: string;

  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;
}

@Controller('probe')
class ProbeController {
  @Get('missing')
  missing(): never {
    throw new NotFoundException('Program 42 does not exist.');
  }

  @Get('forbidden')
  forbidden(): never {
    throw new ForbiddenException();
  }

  @Get('transition')
  transition(): never {
    throw new InvalidStateTransitionError('Contract', 'DRAFT', 'ACTIVE');
  }

  @Get('invalid-value')
  invalidValue(): never {
    throw new InvalidValueError('nationalId', 'DNI control letter does not match.');
  }

  @Get('boom')
  boom(): never {
    throw new Error('database password is hunter2');
  }

  @Post('sign-up')
  signUp(@Body() body: SignUpDto): SignUpDto {
    return body;
  }
}

describe('ProblemDetailsFilter', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: httpErrorHandlingProviders,
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should render http exceptions as problem details', async () => {
    const response = await request(app.getHttpServer()).get('/probe/missing');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.body).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'Program 42 does not exist.',
      instance: '/probe/missing',
    });
  });

  it('should omit the query string from instance', async () => {
    const response = await request(app.getHttpServer()).get('/probe/missing?email=ana@example.com');

    expect(response.body.instance).toBe('/probe/missing');
  });

  it('should omit detail when it would only repeat the title', async () => {
    const response = await request(app.getHttpServer()).get('/probe/forbidden');

    expect(response.status).toBe(403);
    expect(response.body).not.toHaveProperty('detail');
  });

  it('should map domain errors by category with their stable code', async () => {
    const response = await request(app.getHttpServer()).get('/probe/transition');

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      type: 'urn:tramo:problem:invalid-state-transition',
      title: 'Invalid state transition',
      code: 'invalid_state_transition',
      detail: 'Contract cannot move from DRAFT to ACTIVE.',
    });
  });

  it('should report the offending field of an invalid domain value', async () => {
    const response = await request(app.getHttpServer()).get('/probe/invalid-value');

    expect(response.status).toBe(422);
    expect(response.body.errors).toEqual([
      { field: 'nationalId', message: 'DNI control letter does not match.' },
    ]);
  });

  it('should hide internal details when the error is unexpected', async () => {
    const response = await request(app.getHttpServer()).get('/probe/boom');

    expect(response.status).toBe(500);
    expect(response.body.detail).toBe('An unexpected error occurred.');
    expect(JSON.stringify(response.body)).not.toContain('hunter2');
  });

  it('should list every invalid field including nested ones when validation fails', async () => {
    const response = await request(app.getHttpServer())
      .post('/probe/sign-up')
      .send({ email: 'nope', address: { number: 0 } });

    expect(response.status).toBe(400);
    expect(response.body.type).toBe('urn:tramo:problem:validation-error');
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'email' }),
        expect.objectContaining({ field: 'address.number' }),
      ]),
    );
  });

  it('should reject properties that are not part of the contract', async () => {
    const response = await request(app.getHttpServer())
      .post('/probe/sign-up')
      .send({ email: 'ana@example.com', address: { number: 3 }, role: 'admin' });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([
      { field: 'role', message: 'property role should not exist' },
    ]);
  });
});

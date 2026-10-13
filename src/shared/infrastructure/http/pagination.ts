import { HttpStatus } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type PageRequest } from '@shared/application';

import { ApiProblems } from './problem-details';

export class CursorPageQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  @ApiPropertyOptional({ description: 'nextCursor from the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  toPageRequest(): PageRequest {
    return { limit: this.limit ?? DEFAULT_PAGE_SIZE, cursor: this.cursor };
  }
}

// On every route that takes a CursorPageQueryDto: a bad `limit` is a 400, and a cursor that does
// not decode is a 422 (`InvalidValueError` from decodeCursor), whatever the list.
export const ApiCursorPaginated = (): MethodDecorator =>
  ApiProblems(HttpStatus.BAD_REQUEST, HttpStatus.UNPROCESSABLE_ENTITY);

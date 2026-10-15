import { type INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

import { PROBLEM_CONTENT_TYPE, statusTitle } from './problem-details';

export const API_KEY_HEADER = 'X-Api-Key';

// The only fractional numbers the api exchanges: scores and their factors. Every other number is
// a whole one (cents, basis points, months, counts), and the document says so, so a client
// generated from it never sends money as a float.
const FRACTIONAL = new Set(['score', 'averageScore', 'value', 'points']);

interface PropertySchema {
  type?: string;
  items?: PropertySchema;
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Tramo API')
      .setDescription(
        'Education financing: programs, applications, scoring, contracts and collections. ' +
          'Errors follow RFC 9457 (application/problem+json).',
      )
      .setVersion('1')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', in: 'header', name: API_KEY_HEADER }, 'api-key')
      .build(),
  );
  const wholeUnlessFractional = (name: string, property: PropertySchema | undefined): void => {
    if (!property || FRACTIONAL.has(name)) return;
    const target = property.type === 'array' ? property.items : property;
    if (target?.type === 'number') target.type = 'integer';
  };
  for (const schema of Object.values(document.components?.schemas ?? {})) {
    const properties = (schema as { properties?: Record<string, PropertySchema> }).properties;
    for (const [name, property] of Object.entries(properties ?? {})) {
      wholeUnlessFractional(name, property);
    }
  }
  // Query and path parameters too (`limit`, `minPriceCents`...).
  for (const item of Object.values(document.paths)) {
    for (const operation of Object.values(item as Record<string, unknown>)) {
      const parameters = (operation as { parameters?: unknown[] } | undefined)?.parameters ?? [];
      for (const parameter of parameters as { name?: string; schema?: PropertySchema }[]) {
        wholeUnlessFractional(parameter.name ?? '', parameter.schema);
      }
    }
  }
  addPipelineStatuses(document);
  return document;
}

interface Operation {
  requestBody?: unknown;
  responses: Record<string, unknown>;
}

// Statuses the HTTP pipeline answers on any route, whatever its handler: 503 while the database
// cannot be reached, 429 past the rate limit (not on the signed provider callbacks, which are
// exempt), and 413 or 415 for a body too large or not JSON.
function addPipelineStatuses(document: OpenAPIObject): void {
  const problem = (status: number): unknown => ({
    description: statusTitle(status),
    content: {
      [PROBLEM_CONTENT_TYPE]: { schema: { $ref: '#/components/schemas/ProblemDetailsSchema' } },
    },
  });
  for (const [path, item] of Object.entries(document.paths)) {
    // Health checks answer their own body and are not rate limited.
    if (path.includes('/health/')) continue;
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = (item as Record<string, Operation | undefined>)[method];
      if (!operation) continue;
      const statuses = [503, ...(path.includes('/webhooks/') ? [] : [429])];
      if (operation.requestBody) statuses.push(413, 415);
      for (const status of statuses) {
        operation.responses[String(status)] ??= problem(status);
      }
    }
  }
}

export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app), {
    jsonDocumentUrl: 'docs/openapi.json',
  });
}

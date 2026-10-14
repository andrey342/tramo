import { type INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

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
  for (const schema of Object.values(document.components?.schemas ?? {})) {
    const properties = (schema as { properties?: Record<string, PropertySchema> }).properties;
    for (const [name, property] of Object.entries(properties ?? {})) {
      if (FRACTIONAL.has(name)) continue;
      const target = property.type === 'array' ? property.items : property;
      if (target?.type === 'number') target.type = 'integer';
    }
  }
  return document;
}

export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app), {
    jsonDocumentUrl: 'docs/openapi.json',
  });
}

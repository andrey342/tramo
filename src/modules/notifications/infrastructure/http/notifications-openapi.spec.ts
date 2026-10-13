import { type INestApplication } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { aDelivery, NOW } from '../../../../../test/factories/notifications';

import { WebhooksController } from './webhooks.controller';

// Integrators match on the error categories they read in the OpenAPI examples; an example must be
// a value the API actually returns.
describe('notifications OpenAPI document', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        { provide: CommandBus, useValue: {} },
        { provide: QueryBus, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
  });

  afterAll(async () => {
    await app.close();
  });

  it('should show the lastError a delivery records when the endpoint answers 503', () => {
    const delivery = aDelivery();
    delivery.recordAttempt(1, { statusCode: 503 }, false, NOW);
    const schema = document.components?.schemas?.['WebhookDeliveryResponse'] as
      { properties?: Record<string, { example?: unknown }> } | undefined;

    expect(schema?.properties?.['lastError']?.example).toBe(delivery.attempts[0]?.error);
  });
});

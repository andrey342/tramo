import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { FindCenterQuery } from '@modules/catalog/application/dto/center-lookup';
import {
  FindUserContactQuery,
  ListCenterContactsQuery,
} from '@modules/iam/application/dto/contact-lookup';

import {
  type Centers,
  type Recipients,
  type WebhookSecrets,
} from '../../application/ports/notifications-ports';

// Asks iam where to write, through its public queries (ADR 008).
@Injectable()
export class IamRecipients implements Recipients {
  constructor(private readonly queries: QueryBus) {}

  async userEmail(userId: string): Promise<string | null> {
    const contact = await this.queries.execute(new FindUserContactQuery(userId));
    return contact?.email ?? null;
  }

  async centerContacts(centerId: string): Promise<readonly string[]> {
    const contacts = await this.queries.execute(new ListCenterContactsQuery(centerId));
    return contacts.map((contact) => contact.email);
  }
}

@Injectable()
export class CatalogCenters implements Centers {
  constructor(private readonly queries: QueryBus) {}

  async exists(centerId: string): Promise<boolean> {
    return (await this.queries.execute(new FindCenterQuery(centerId))) !== null;
  }
}

// 32 random bytes, prefixed so a leaked one is recognisable in logs and secret scanners.
@Injectable()
export class RandomWebhookSecrets implements WebhookSecrets {
  generate(): string {
    return `whsec_${randomBytes(32).toString('base64url')}`;
  }
}

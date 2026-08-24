import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DAY_MS = 86_400_000;

@Injectable()
export class BusinessTimeService {
  readonly timezone: string;

  constructor(config: ConfigService) {
    this.timezone = config.getOrThrow<string>('BUSINESS_TIMEZONE');
  }

  businessDateKey(instant: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((entry) => entry.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  databaseDateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  daysUntil(dueDate: Date, asOf: Date): number {
    return this.ordinal(this.databaseDateKey(dueDate)) - this.ordinal(this.businessDateKey(asOf));
  }

  businessDate(asOf: Date): Date {
    return new Date(`${this.businessDateKey(asOf)}T00:00:00.000Z`);
  }

  addBusinessDays(asOf: Date, days: number): Date {
    const date = this.businessDate(asOf);
    date.setUTCDate(date.getUTCDate() + days);
    return date;
  }

  private ordinal(dateKey: string): number {
    return Math.floor(Date.parse(`${dateKey}T00:00:00.000Z`) / DAY_MS);
  }
}

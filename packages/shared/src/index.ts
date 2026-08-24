export const ROLE_CODES = ['ADMIN', 'ACCOUNTANT', 'IT', 'SALES_DEVELOPMENT', 'MANAGEMENT'] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  roles: RoleCode[];
}

export interface HealthComponent {
  status: 'up' | 'down';
}

export interface ReadinessResponse {
  status: 'ok' | 'degraded';
  services: {
    database: HealthComponent;
    redis: HealthComponent;
  };
}

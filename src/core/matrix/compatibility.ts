import type { NordixConfig } from '../schema/nordix.schema.js';

export interface CompatibilityCheckResult {
  isValid: boolean;
  status: 'golden-path' | 'supported' | 'community-planned' | 'incompatible';
  errors: string[];
  warnings: string[];
}

export function checkCompatibility(config: NordixConfig): CompatibilityCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { frontend, backend, database, deployment } = config;

  // 1. Check Golden Path
  const isGoldenPath =
    frontend.framework === 'nextjs' &&
    frontend.styling === 'tailwind' &&
    backend.framework === 'hono' &&
    database.engine === 'postgres' &&
    database.orm === 'drizzle' &&
    deployment.provider === 'cloudflare';

  // 2. Incompatible ORM & Backend combinations
  if (database.orm === 'efcore' && backend.framework !== 'dotnet') {
    errors.push(
      `Incompatible combination: EF Core ORM is only compatible with the '.NET' backend framework, but found '${backend.framework}'.`,
    );
  }

  if (backend.framework === 'hono' && database.engine === 'mongodb' && database.orm === 'drizzle') {
    errors.push(
      'Incompatible combination: Drizzle ORM does not support MongoDB. Use PostgreSQL or SQLite with Drizzle.',
    );
  }

  // 3. Deployment & Runtime constraints
  if (deployment.provider === 'cloudflare') {
    if (backend.framework === 'dotnet' || backend.framework === 'django') {
      errors.push(
        `Incompatible combination: Backend '${backend.framework}' cannot run directly on Cloudflare Workers. Use 'vps' (Docker) or a container platform.`,
      );
    }

    if (backend.framework === 'nestjs') {
      warnings.push(
        'Cloudflare Workers with NestJS requires containerized or nodejs_compat workarounds. For pure edge performance, Hono is recommended.',
      );
    }

    if (database.orm === 'prisma') {
      warnings.push(
        'Using Prisma on Cloudflare Workers increases worker bundle size significantly (~1.5-2.5MB), approaching the 3MB Free tier limit. Drizzle ORM (<30KB) is recommended for edge deployments.',
      );
    }
  }

  // 4. Community Planned Frameworks (extensible roadmap)
  const isPlannedCommunityFramework =
    backend.framework === 'dotnet' ||
    backend.framework === 'django' ||
    backend.framework === 'nestjs' ||
    frontend.framework === 'angular' ||
    frontend.framework === 'react-native';

  if (isPlannedCommunityFramework && errors.length === 0) {
    warnings.push(
      `Framework '${backend.framework !== 'hono' ? backend.framework : frontend.framework}' is registered in the NordixGen extensible roadmap. Core generator currently focuses on Golden Path (Next.js + Hono). You can contribute generator plugins via Nordix-IR adapters!`,
    );
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      status: 'incompatible',
      errors,
      warnings,
    };
  }

  if (isGoldenPath) {
    return {
      isValid: true,
      status: 'golden-path',
      errors,
      warnings,
    };
  }

  if (isPlannedCommunityFramework) {
    return {
      isValid: true,
      status: 'community-planned',
      errors,
      warnings,
    };
  }

  return {
    isValid: true,
    status: 'supported',
    errors,
    warnings,
  };
}

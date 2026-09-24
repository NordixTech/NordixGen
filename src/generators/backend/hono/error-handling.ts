export function generateErrorHandlingCode(): string {
  return `/**
 * RFC 7807 Problem Details for HTTP APIs
 * Standardized error handling across all NordixGen backends
 */

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  invalidParams?: Array<{ name: string; reason: string }>;
  [key: string]: unknown;
}

export class AppError extends Error {
  public readonly status: number;
  public readonly type: string;
  public readonly title: string;
  public readonly detail: string;
  public readonly invalidParams?: Array<{ name: string; reason: string }>;

  constructor(status: number, title: string, detail: string, type = 'about:blank', invalidParams?: Array<{ name: string; reason: string }>) {
    super(detail);
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.type = type;
    this.invalidParams = invalidParams;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toProblemDetails(instance?: string): ProblemDetails {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      detail: this.detail,
      instance,
      invalidParams: this.invalidParams,
    };
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string) {
    super(404, 'Resource Not Found', identifier ? \`\${resource} with identifier '\${identifier}' was not found.\` : \`\${resource} was not found.\`, 'https://httpstatuses.com/404');
  }
}

export class ValidationError extends AppError {
  constructor(detail: string, invalidParams?: Array<{ name: string; reason: string }>) {
    super(400, 'Validation Failed', detail, 'https://httpstatuses.com/400', invalidParams);
  }
}

export class UnauthorizedError extends AppError {
  constructor(detail = 'Authentication is required to access this resource.') {
    super(401, 'Unauthorized', detail, 'https://httpstatuses.com/401');
  }
}

export class ForbiddenError extends AppError {
  constructor(detail = 'You do not have permission to perform this action.') {
    super(403, 'Forbidden', detail, 'https://httpstatuses.com/403');
  }
}

export class ConflictError extends AppError {
  constructor(detail: string) {
    super(409, 'Conflict', detail, 'https://httpstatuses.com/409');
  }
}
`;
}

export function generateErrorHandlerMiddlewareCode(): string {
  return `import type { ErrorHandler } from 'hono';
import { AppError } from './errors.js';

export const rfc7807ErrorHandler: ErrorHandler = (err, c) => {
  const url = c.req.url;

  if (err instanceof AppError) {
    c.header('Content-Type', 'application/problem+json');
    return c.json(err.toProblemDetails(url), err.status as any);
  }

  // Handle generic / unexpected internal errors safely
  console.error('[Unhandled Server Error]:', err);
  c.header('Content-Type', 'application/problem+json');
  return c.json(
    {
      type: 'https://httpstatuses.com/500',
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected internal error occurred on the server.',
      instance: url,
    },
    500,
  );
};
`;
}

/** Defaults for existing configurations; each backend may override its public policy. */
export const ACCOUNT_POLICY = Object.freeze({ minPasswordLength: 8 });

export interface PasswordPolicy {
  minLength: number;
  maxLength: number;
  numericOnly: boolean;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSpecialChar: boolean;
}
export const DEFAULT_PASSWORD_POLICY: Readonly<PasswordPolicy> = Object.freeze({
  minLength: ACCOUNT_POLICY.minPasswordLength,
  maxLength: 128,
  numericOnly: false,
  requireUppercase: false,
  requireLowercase: false,
  requireNumber: false,
  requireSpecialChar: false,
});
export function durationSeconds(value: string | number): number {
  if (typeof value === "number") return value;
  const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return Number(value.slice(0, -1)) * units[value.slice(-1)];
}

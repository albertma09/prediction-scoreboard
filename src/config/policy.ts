export const POLICY_VERSION = '2';

export const RESOLVER_VERSION = '2.0.0';

export function resolverMajor(): string {
  const major = RESOLVER_VERSION.split('.')[0];
  if (major === undefined) {
    throw new Error(`resolver_version malformada: ${RESOLVER_VERSION}`);
  }
  return major;
}

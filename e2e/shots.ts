import { join } from 'node:path';

export function shotDir(spec: string): string {
  return join(process.env.BAB_SHOTS ?? 'test-results/shots', spec);
}

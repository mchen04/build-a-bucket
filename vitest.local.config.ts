import { mergeConfig } from 'vitest/config';
import base from './vite.config';

export default mergeConfig(base, {
  test: {
    setupFiles: ['./tests/local-db.setup.ts'],
  },
});

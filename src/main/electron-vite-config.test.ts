import { describe, expect, it } from 'vitest';
import config from '../../electron.vite.config';

describe('Electron 构建配置', () => {
  it('将 sandbox preload 编译为 CommonJS 文件', () => {
    const preload = config.preload as {
      build?: {
        rollupOptions?: {
          output?: { format?: string; entryFileNames?: string };
        };
      };
    };

    expect(preload.build?.rollupOptions?.output?.format).toBe('cjs');
    expect(preload.build?.rollupOptions?.output?.entryFileNames).toBe('[name].cjs');
  });
});

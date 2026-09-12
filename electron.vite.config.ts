import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {},
  // Electron 的 sandbox preload 只支持 CommonJS；ESM 会在应用打包后导致
  // contextBridge 无法注入，从而使渲染进程只能显示空白窗口。
  preload: {
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    plugins: [react()]
  }
});

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/startup/cli.ts'],
  outDir: 'build/dist',
  format: ['cjs'],
  platform: 'node',
  clean: false,
  minify: false,
  shims: true,
  removeNodeProtocol: false,
  target: 'node20',
  // 核心逻辑：内联所有必要的依赖，避免运行时加载问题
  noExternal: [
    'inversify',
    'reflect-metadata',
    'zod',
    '@modelcontextprotocol/sdk'
  ],
  // 仅保留 Node.js 原生模块以及可能引起问题的二进制模块为外部
  external: ['node:sqlite', '@larksuiteoapi/node-sdk', 'express'],
  treeshake: true,
  splitting: false,
  sourcemap: true,
});

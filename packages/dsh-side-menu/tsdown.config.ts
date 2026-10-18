import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/client.ts'],
  outDir: 'lib',
  format: 'esm',
  dts: true,
  clean: true,
  outExtension: () => ({ js: '.js', dts: '.d.ts' }),
})

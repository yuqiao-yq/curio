import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * 独立的 vitest 配置，故意不复用 wxt.config.ts —— wxt 注入的 webextension 全局
 * 和 manifest 校验在测试环境是噪音。
 *
 * 没用 @vitejs/plugin-react：它的最新版会拉一个比 wxt 锁定的 vite 5 更新的
 * vite 类型，导致 tsc 报跨版本类型冲突。Vitest 自带的 esbuild 已经能把 TSX
 * 转成可执行 JS（jsx-runtime 自动注入），React 单测足够用。
 */
export default defineConfig({
  resolve: {
    alias: {
      // 与 wxt 的 @ 别名保持一致（wxt 默认把 @ 指向 srcDir，本项目 srcDir 是仓库根）
      '@': path.resolve(__dirname, '.'),
    },
  },
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/test/**',
        'src/types/**',
        '**/*.d.ts',
      ],
    },
  },
})

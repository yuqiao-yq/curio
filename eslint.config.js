// ESLint 9 flat config
// 目标：抓真实 bug + 一致性，不卷代码风格（风格交给 Prettier）。
// 历史代码已有 30k+ 行没过 lint，所以默认偏宽松；新代码后续可逐步收紧。
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactPlugin from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default [
  {
    ignores: [
      'node_modules/**',
      '.wxt/**',
      '.output/**',
      'dist/**',
      'public/**',
      'scripts/**',
      'stats.html',
      'stats-*.json',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        // WXT 注入的全局
        chrome: 'readonly',
        browser: 'readonly',
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: '18' },
    },
    rules: {
      // ── TypeScript ──
      // 大量 store / repository 里有合法的 _ 前缀未用参数；不强制
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // 项目里有少量必要的 any（chrome API 返回、JSON 解析等）；收到 warn 不阻塞
      '@typescript-eslint/no-explicit-any': 'warn',
      // ts-expect-error / ts-ignore 允许带说明
      '@typescript-eslint/ban-ts-comment': [
        'warn',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': 'allow-with-description' },
      ],

      // ── React ──
      // React 17+ 自动 jsx-runtime，不再需要 import React
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off', // 用 TS 类型替代
      'react/jsx-uses-react': 'off',
      'react/jsx-uses-vars': 'error',
      'react/no-unknown-property': 'warn',

      // ── React Hooks ──
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // ── 通用 ──
      // 大量 console.log / console.warn 是有意保留的调试信息
      'no-console': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // chrome.storage callback 里 prefer-const 偶尔报警，统一 warn
      'prefer-const': 'warn',
      // 允许 `cond ? a() : b()` 和 `cond && doSomething()` —— zustand store
      // 和 React handler 里大量这种短路写法，强行改成 if/else 反而更啰嗦
      '@typescript-eslint/no-unused-expressions': [
        'error',
        { allowShortCircuit: true, allowTernary: true, allowTaggedTemplates: true },
      ],
    },
  },

  // 测试文件放宽
  {
    files: ['**/*.{test,spec}.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        // vitest 全局（仅在 vitest config 开了 globals 时启用；为安全显式列出）
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterAll: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
]

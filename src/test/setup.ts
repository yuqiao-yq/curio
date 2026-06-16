/**
 * Vitest 全局 setup
 *
 * 做两件事：
 *  1. 把 jsdom 没有但代码里会用的浏览器 API 打 polyfill / mock
 *  2. 把 WebExtension 的 chrome.* 给一个最小可用的 in-memory mock，
 *     避免任何 import chain 一加载就因为 `chrome is not defined` 炸掉
 */
import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { vi, beforeEach } from 'vitest'

// ── chrome.* 最小 mock ──────────────────────────────────────────────
type Listener = (...args: unknown[]) => void

function makeStorageArea() {
  let store: Record<string, unknown> = {}
  const listeners = new Set<Listener>()
  return {
    _store: () => store,
    _reset: () => {
      store = {}
    },
    get: vi.fn((keys: string | string[] | Record<string, unknown> | null) => {
      if (keys == null) return Promise.resolve({ ...store })
      if (typeof keys === 'string') return Promise.resolve({ [keys]: store[keys] })
      if (Array.isArray(keys)) {
        const out: Record<string, unknown> = {}
        keys.forEach((k) => (out[k] = store[k]))
        return Promise.resolve(out)
      }
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(keys)) {
        out[k] = store[k] ?? (keys as Record<string, unknown>)[k]
      }
      return Promise.resolve(out)
    }),
    set: vi.fn((items: Record<string, unknown>) => {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {}
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: store[k], newValue: v }
        store[k] = v
      }
      listeners.forEach((fn) => fn(changes, 'local'))
      return Promise.resolve()
    }),
    remove: vi.fn((keys: string | string[]) => {
      const arr = Array.isArray(keys) ? keys : [keys]
      const changes: Record<string, { oldValue?: unknown }> = {}
      arr.forEach((k) => {
        changes[k] = { oldValue: store[k] }
        delete store[k]
      })
      listeners.forEach((fn) => fn(changes, 'local'))
      return Promise.resolve()
    }),
    clear: vi.fn(() => {
      store = {}
      return Promise.resolve()
    }),
    onChanged: {
      addListener: (fn: Listener) => listeners.add(fn),
      removeListener: (fn: Listener) => listeners.delete(fn),
    },
  }
}

const chromeMock = {
  storage: {
    local: makeStorageArea(),
    sync: makeStorageArea(),
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  bookmarks: {
    getTree: vi.fn(() => Promise.resolve([])),
    create: vi.fn(),
    remove: vi.fn(),
    removeTree: vi.fn(),
    update: vi.fn(),
    move: vi.fn(),
    search: vi.fn(() => Promise.resolve([])),
  },
  history: {
    search: vi.fn(() => Promise.resolve([])),
  },
  runtime: {
    id: 'test-extension-id',
    getURL: (p: string) => `chrome-extension://test/${p}`,
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    lastError: undefined,
  },
  tabs: {
    query: vi.fn(() => Promise.resolve([])),
    create: vi.fn(),
    update: vi.fn(),
  },
}

// 同时挂到 globalThis.chrome 和 globalThis.browser（WXT 的 polyfill 入口）
;(globalThis as unknown as { chrome: typeof chromeMock }).chrome = chromeMock
;(globalThis as unknown as { browser: typeof chromeMock }).browser = chromeMock

// ── 每个测试自动清理 storage，防止互相污染 ────────────────────────────
beforeEach(() => {
  chromeMock.storage.local._reset()
  chromeMock.storage.sync._reset()
})

// ── matchMedia mock（jsdom 没实现，theme / dark mode 代码会用） ──────
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

/**
 * 脚手架冒烟测试 —— 验证 vitest + setup 跑通。
 * 后续可以删，留着也无害（运行成本几乎为 0）。
 */
import { describe, expect, it } from 'vitest'

describe('test infrastructure', () => {
  it('vitest is running', () => {
    expect(1 + 1).toBe(2)
  })

  it('jsdom is wired up', () => {
    document.body.innerHTML = '<div id="root">hi</div>'
    expect(document.getElementById('root')?.textContent).toBe('hi')
  })

  it('chrome.storage mock works', async () => {
    await chrome.storage.local.set({ foo: 'bar' })
    const got = await chrome.storage.local.get('foo')
    expect(got.foo).toBe('bar')
  })

  it('fake-indexeddb is loaded', () => {
    expect(typeof indexedDB).toBe('object')
    expect(typeof indexedDB.open).toBe('function')
  })
})

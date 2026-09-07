import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSearchBox } from './WebSearchBox'
import { useBookmarkStore } from '../stores/useBookmarkStore'

beforeEach(() => {
  useBookmarkStore.setState({
    cards: [0, 1, 2].map((i) => ({
      id: String(i),
      categoryId: 'a',
      title: `Example ${i}`,
      url: `https://example.com/${i}`,
      order: i,
      createdAt: 1,
      updatedAt: 1,
    })),
  })
  vi.spyOn(window, 'open').mockImplementation(() => null)
})
afterEach(() => vi.restoreAllMocks())

describe('书签搜索键盘交互', () => {
  it('本地搜索可用方向键选择并回车打开', () => {
    render(<WebSearchBox />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '@bm Example' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(window.open).toHaveBeenCalledWith(
      'https://example.com/1',
      '_blank',
      'noopener,noreferrer',
    )
  })
  it('中文输入法确认不会打开页面，Esc 清空搜索', () => {
    render(<WebSearchBox />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Example' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(window.open).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input).toHaveValue('')
  })
})

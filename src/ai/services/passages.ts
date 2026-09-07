/** 本地段落评分；中文使用双字词组，英文保留完整词。返回原文偏移便于核对来源。 */
export function queryTerms(query: string): string[] {
  const words = query.toLowerCase().match(/[a-z0-9]+|\p{Script=Han}+/gu) ?? []
  return [
    ...new Set(
      words.flatMap((word) =>
        /\p{Script=Han}/u.test(word) && word.length > 1
          ? Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2))
          : [word],
      ),
    ),
  ]
}

export function lexicalScore(text: string, terms: string[]): number {
  if (!terms.length) return 0
  const lower = text.toLowerCase()
  return terms.filter((term) => lower.includes(term)).length / terms.length
}

export function bestPassage(content: string, terms: string[], maxChars = 1500) {
  const size = Math.max(100, Math.min(1500, maxChars))
  let best = { text: content.slice(0, size), start: 0, score: 0 }
  for (let start = 0; start < content.length; start += Math.max(1, Math.floor(size / 2))) {
    const text = content.slice(start, start + size)
    const score = lexicalScore(text, terms)
    if (score > best.score) best = { text, start, score }
  }
  return best
}

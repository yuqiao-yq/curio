#!/usr/bin/env node
/**
 * 从 public/icon.svg / public/icon-simple.svg 渲染出多尺寸 PNG。
 *
 * 输出：
 *   public/icon/16.png    (扩展工具栏小图标 + 浏览器标签 favicon)
 *   public/icon/32.png    (Mac retina favicon / extension grid)
 *   public/icon/48.png    (chrome://extensions/ 列表)
 *   public/icon/96.png    (Firefox toolbar @2x / 部分系统 launcher)
 *   public/icon/128.png   (Chrome Web Store 上架 / 安装弹窗)
 *
 * 16 / 32 用 icon-simple.svg（C 略大、ribbon 更靠中心，小尺寸更清晰）
 * 48+ 用 icon.svg（完整设计）
 *
 * 触发：pnpm icons
 * WXT 会自动扫描 public/icon/*.png 注入 chrome.manifest.icons 与 action.default_icon。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const mainSvg = readFileSync(resolve(root, 'public/icon.svg'))
const simpleSvg = readFileSync(resolve(root, 'public/icon-simple.svg'))

const outDir = resolve(root, 'public/icon')
mkdirSync(outDir, { recursive: true })

/** @type {Array<{ size: number; src: Buffer; reason: string }>} */
const targets = [
  { size: 16,  src: simpleSvg, reason: 'simple · favicon / toolbar 小图标' },
  { size: 32,  src: simpleSvg, reason: 'simple · favicon @2x' },
  { size: 48,  src: mainSvg,   reason: 'main · chrome://extensions/ 列表' },
  { size: 96,  src: mainSvg,   reason: 'main · Firefox toolbar @2x' },
  { size: 128, src: mainSvg,   reason: 'main · Chrome Web Store 上架尺寸' },
]

console.log('🎨 Generating Curio icons from SVG ...\n')

for (const { size, src, reason } of targets) {
  const resvg = new Resvg(src, {
    // 用 fitTo 把 viewBox 等比缩放到目标 size
    fitTo: { mode: 'width', value: size },
    // 高质量抗锯齿（resvg 默认就是好的，这里显式声明）
    shapeRendering: 2,  // 0=optimizeSpeed, 1=crispEdges, 2=geometricPrecision
    textRendering: 2,   // 同上（虽然我们没文本，无害）
    background: 'transparent',
  })
  const png = resvg.render().asPng()
  const out = resolve(outDir, `${size}.png`)
  writeFileSync(out, png)
  console.log(`  ✓ ${size.toString().padStart(3)} × ${size}  →  public/icon/${size}.png   (${reason})`)
}

console.log('\n✨ Done. WXT 下次 build 时会自动注入 manifest.icons。')

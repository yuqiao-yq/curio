import { browser } from 'wxt/browser'

function originPattern(url: string): string {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('仅支持 HTTP(S) 模型地址')
  return `${parsed.protocol}//${parsed.hostname}/*`
}

/** 必须由点击处理器直接调用；模型仅申请自身域名，批量抓取按需申请网站访问。 */
export function requestSiteAccess(url?: string): Promise<boolean> {
  return browser.permissions.request({ origins: url ? [originPattern(url)] : ['<all_urls>'] })
}

export async function requireSiteAccess(url: string): Promise<void> {
  if (!(await browser.permissions.contains({ origins: [originPattern(url)] }))) {
    throw new Error('尚未授权访问此模型地址，请在 AI 设置中点击「测试连接」授予权限')
  }
}

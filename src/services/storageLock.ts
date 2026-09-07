/** 同一扩展 origin 的页面和后台共享 Web Lock，避免 storage 的读改写互相覆盖。 */
export async function withStorageLock<T>(name: string, action: () => Promise<T>): Promise<T> {
  if (!globalThis.navigator?.locks) {
    return Promise.reject(new Error('浏览器不支持安全并发写入，请升级浏览器后重试。'))
  }
  return await navigator.locks.request(`curio:${name}`, action)
}

export const LOCAL_CHANGE_KEY = 'curio:data-change'
export const LOCAL_WRITER_ID = crypto.randomUUID()

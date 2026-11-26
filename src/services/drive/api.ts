import { accessToken, type DriveAuth } from './auth'
import {
  equal,
  validateDocument,
  serializeDocument,
  MAX_DOCUMENT_BYTES,
  type DriveDocument,
} from './model'

const API = 'https://www.googleapis.com/drive/v3'
interface DriveFile {
  id: string
  appProperties: { app?: string; version?: string; device?: string; sequence?: string }
}
export class DriveAPI {
  constructor(private auth: DriveAuth) {}
  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    let token = await accessToken(this.auth)
    for (let i = 0; i < 2; i++) {
      const response = await fetch(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      })
      if (response.status === 401 && i === 0) {
        token = await accessToken(this.auth, true)
        continue
      }
      return response
    }
    throw new Error('Google 授权失效，请重新连接。')
  }
  private async checked(url: string, init?: RequestInit): Promise<Response> {
    const response = await this.request(url, init)
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? 'Google 授权失效，请重新连接。'
          : `Drive 请求失败（${response.status}），本地更改已保留，请稍后重试。`,
      )
    return response
  }
  async list(): Promise<DriveFile[]> {
    const files: DriveFile[] = []
    let pageToken = ''
    const pages = new Set<string>()
    do {
      if (pages.has(pageToken) || pages.size >= 100)
        throw new Error('Drive 分页结果异常，已停止同步。')
      pages.add(pageToken)
      const params = new URLSearchParams({
        spaces: 'appDataFolder',
        q: "trashed = false and appProperties has { key='app' and value='curio' }",
        fields: 'nextPageToken,incompleteSearch,files(id,appProperties)',
        pageSize: '1000',
        ...(pageToken ? { pageToken } : {}),
      })
      const data = await (await this.checked(`${API}/files?${params}`)).json()
      if (
        !Array.isArray(data.files) ||
        data.incompleteSearch ||
        (data.nextPageToken !== undefined && typeof data.nextPageToken !== 'string')
      )
        throw new Error('无法完整读取 Drive 文件列表。')
      files.push(...data.files)
      if (files.length > 20_000) throw new Error('Drive 快照过多，请检查同步目录。')
      pageToken = data.nextPageToken ?? ''
    } while (pageToken)
    return files
  }
  async read(id: string): Promise<DriveDocument> {
    const response = await this.checked(`${API}/files/${encodeURIComponent(id)}?alt=media`)
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Drive 返回了空文件，未应用。')
    const decoder = new TextDecoder()
    let bytes = 0,
      content = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > MAX_DOCUMENT_BYTES) {
          await reader.cancel()
          throw new Error('Drive 快照超过 4 MiB 安全上限，未应用。')
        }
        content += decoder.decode(value, { stream: true })
      }
      content += decoder.decode()
    } finally {
      reader.releaseLock()
    }
    return validateDocument(JSON.parse(content))
  }
  async readLatest(): Promise<{ documents: DriveDocument[]; files: DriveFile[] }> {
    const files = await this.list()
    const latest = new Map<string, DriveFile>()
    for (const file of files) {
      const p = file.appProperties
      if (
        p?.version !== '1' ||
        !p.device ||
        !/^[1-9]\d*$/.test(p.sequence ?? '') ||
        !Number.isSafeInteger(Number(p.sequence))
      )
        throw new Error('Drive 中存在不兼容的 Curio 快照，请升级扩展后重试。')
      const old = latest.get(p.device)
      if (old && p.sequence === old.appProperties.sequence)
        throw new Error('Drive 中存在重复版本，已停止同步以保护数据。')
      if (!old || Number(p.sequence) > Number(old.appProperties.sequence))
        latest.set(p.device, file)
    }
    const documents: DriveDocument[] = []
    for (const file of latest.values()) {
      const document = await this.read(file.id)
      if (
        document.device !== file.appProperties.device ||
        String(document.sequence) !== file.appProperties.sequence
      )
        throw new Error('Drive 文件元数据与内容不一致，已停止同步。')
      documents.push(document)
    }
    return { documents, files }
  }
  async generateId(): Promise<string> {
    const data = await (
      await this.checked(`${API}/files/generateIds?count=1&space=appDataFolder&type=files`)
    ).json()
    if (typeof data.ids?.[0] !== 'string') throw new Error('无法分配 Drive 文件 ID。')
    return data.ids[0]
  }
  async upload(id: string, document: DriveDocument): Promise<void> {
    const text = serializeDocument(document)
    const boundary = `curio_${crypto.randomUUID()}`
    const metadata = {
      id,
      name: `curio-v1-${document.device}-${document.sequence}.json`,
      parents: ['appDataFolder'],
      mimeType: 'application/json',
      appProperties: {
        app: 'curio',
        version: '1',
        device: document.device,
        sequence: String(document.sequence),
      },
    }
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`
    const response = await this.request(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      },
    )
    // Google reserves generated IDs across failed/retried creates. Verify before acknowledging.
    if (response.status === 409) {
      if (!equal(await this.read(id), document))
        throw new Error('Drive 上传版本冲突，已保留本地更改。')
    } else if (!response.ok)
      throw new Error(`Drive 上传失败（${response.status}），本地更改等待重试。`)
  }
  async prune(files: DriveFile[], device: string): Promise<void> {
    const own = files
      .filter((f) => f.appProperties.device === device)
      .sort((a, b) => Number(b.appProperties.sequence) - Number(a.appProperties.sequence))
    // Retain at least three immutable snapshots; never remove another device's history or tombstones.
    for (const file of own.slice(3)) {
      const response = await this.request(`${API}/files/${encodeURIComponent(file.id)}`, {
        method: 'DELETE',
      })
      if (!response.ok && response.status !== 404) return
    }
  }
}

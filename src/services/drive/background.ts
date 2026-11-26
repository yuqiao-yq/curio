import { browser } from 'wxt/browser'
import { LOCAL_CHANGE_KEY } from '../storageLock'
import { DRIVE_STATE_KEY, type DriveState } from './model'
import { syncDrive } from './sync'

const ALARM = 'curio-drive-sync'
/** Alarms resume after a suspended MV3 worker; storage events cover popup/newtab edits. */
export function installDriveBackground() {
  const run = () => {
    void syncDrive().catch(() => {
      /* Visible status is persisted by syncDrive. */
    })
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) run()
  })
  const ensureAlarm = async () => {
    if (!(await browser.alarms.get(ALARM)))
      await browser.alarms.create(ALARM, { periodInMinutes: 2, delayInMinutes: 1 })
  }
  browser.runtime.onStartup.addListener(() => {
    void ensureAlarm()
    run()
  })
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    const change = changes[LOCAL_CHANGE_KEY]?.newValue as { source?: string } | undefined
    const enabled =
      (changes[DRIVE_STATE_KEY]?.newValue as DriveState | undefined)?.enabled &&
      !(changes[DRIVE_STATE_KEY]?.oldValue as DriveState | undefined)?.enabled
    if ((change && change.source !== 'drive') || enabled) {
      if (timer) clearTimeout(timer)
      timer = setTimeout(run, 1500)
    }
  })
  globalThis.addEventListener('online', run)
  void ensureAlarm()
  run()
}

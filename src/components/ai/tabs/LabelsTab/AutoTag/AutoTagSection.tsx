import { useTaggerStore } from '../../../../../ai/services/useTaggerStore'
import { ConfigStage } from './stages/ConfigStage'
import { EstimateStage } from './stages/EstimateStage'
import { RunningStage } from './stages/RunningStage'
import { PreviewStage } from './stages/PreviewStage'
import { ApplyingStage } from './stages/ApplyingStage'
import { DoneStage } from './stages/DoneStage'
import { ErrorStage } from './stages/ErrorStage'

/* ──────────────────────────────────────────────────────────────────────
 * 「批量打标签」状态机路由：config → estimate → running → preview
 *                          → applying → done / error
 *
 * 每个 Stage 自己从 useTaggerStore 拉所需切片；本路由不传 props。
 * ────────────────────────────────────────────────────────────────────── */

export function AutoTagSection() {
  const stage = useTaggerStore((s) => s.stage)
  switch (stage) {
    case 'config':
      return <ConfigStage />
    case 'estimate':
      return <EstimateStage />
    case 'running':
      return <RunningStage />
    case 'preview':
      return <PreviewStage />
    case 'applying':
      return <ApplyingStage />
    case 'done':
      return <DoneStage />
    case 'error':
      return <ErrorStage />
  }
}

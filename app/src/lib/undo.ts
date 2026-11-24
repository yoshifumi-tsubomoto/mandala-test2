// 自分の書き込みの「取り消し」「やり直し」の記録（この画面を開いているあいだだけ）。
// 取り消し・やり直しも、ふつうの書き換えとして保存される（操作ログは消さずに積み上げる）。

import type { CellPosition } from './grid'
import { unitLabel, type MandalaState } from './mandala'

export type UndoEntry =
  | {
      kind: 'cell'
      unitId: string
      position: CellPosition
      /** 書く前の文字（取り消すとこれに戻る） */
      before: string
      /** 書いた文字（やり直すとこれに戻る） */
      after: string
      /** 書いたあとの版の番号（Supabase のときだけ使う。ほかの人が書き換えていないかを確かめる） */
      version?: number
    }
  | { kind: 'title'; before: string; after: string }

export interface UndoStacks {
  undo: UndoEntry[]
  redo: UndoEntry[]
}

/** 取り消しの記録の上限（古いものから消す） */
export const MAX_UNDO = 100

export const emptyStacks: UndoStacks = { undo: [], redo: [] }

/** 新しく書いたとき：取り消しに積み、やり直しは空にする */
export function recordEdit(stacks: UndoStacks, entry: UndoEntry): UndoStacks {
  return { undo: [...stacks.undo, entry].slice(-MAX_UNDO), redo: [] }
}

/** 取り消しの記録をいちばん上から1つ取り出す */
export function popUndo(stacks: UndoStacks): [UndoEntry | undefined, UndoStacks] {
  const entry = stacks.undo[stacks.undo.length - 1]
  return [entry, { ...stacks, undo: stacks.undo.slice(0, -1) }]
}

export function popRedo(stacks: UndoStacks): [UndoEntry | undefined, UndoStacks] {
  const entry = stacks.redo[stacks.redo.length - 1]
  return [entry, { ...stacks, redo: stacks.redo.slice(0, -1) }]
}

/** 取り消しが終わったら、やり直しに積む（version は取り消したあとの版） */
export function pushRedo(stacks: UndoStacks, entry: UndoEntry): UndoStacks {
  return { ...stacks, redo: [...stacks.redo, entry].slice(-MAX_UNDO) }
}

/** やり直しが終わったら、取り消しに積む（やり直しは残す） */
export function pushUndo(stacks: UndoStacks, entry: UndoEntry): UndoStacks {
  return { ...stacks, undo: [...stacks.undo, entry].slice(-MAX_UNDO) }
}

function quote(text: string): string {
  const t = text.trim()
  if (t === '') return '（空）'
  const short = t.length > 20 ? `${t.slice(0, 20)}…` : t
  return `「${short.replace(/\s+/g, ' ')}」`
}

/**
 * 取り消し・やり直しで何が起きるかを、人が読める文にする。
 * 例：取り消し：「学校生活」のセル3 「授業」→（空）
 */
export function describeEntry(state: MandalaState, entry: UndoEntry, direction: 'undo' | 'redo'): string {
  const verb = direction === 'undo' ? '取り消し' : 'やり直し'
  const [from, to] = direction === 'undo' ? [entry.after, entry.before] : [entry.before, entry.after]
  if (entry.kind === 'title') return `${verb}：テーマ ${quote(from)} → ${quote(to)}`
  const unit = state.units[entry.unitId]
  const where = unit ? `「${unitLabel(state, unit)}」のセル${entry.position}` : `セル${entry.position}`
  return `${verb}：${where} ${quote(from)} → ${quote(to)}`
}

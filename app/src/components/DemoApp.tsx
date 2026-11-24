import { useEffect, useState } from 'react'
import { clearDemo, loadDemo, saveDemo } from '../lib/demoStore'
import type { CellPosition } from '../lib/grid'
import { createMandala, getCell, setCellText, setMandalaColor, setTitle, type MandalaState } from '../lib/mandala'
import { emptyStacks, popRedo, popUndo, pushRedo, pushUndo, recordEdit, type UndoEntry, type UndoStacks } from '../lib/undo'
import { AppHeader } from './AppHeader'
import { MandalaEditor } from './MandalaEditor'

// 体験モード：架空のデータで、このブラウザの中だけで動く。どこにも送らない。

function initialState(): MandalaState {
  return loadDemo() ?? createMandala('')
}

export function DemoApp() {
  const [state, setState] = useState<MandalaState>(initialState)
  const [stacks, setStacks] = useState<UndoStacks>(emptyStacks)

  useEffect(() => {
    saveDemo(state)
  }, [state])

  function apply(s: MandalaState, entry: UndoEntry, text: 'before' | 'after'): MandalaState {
    return entry.kind === 'cell'
      ? setCellText(s, entry.unitId, entry.position, entry[text])
      : setTitle(s, entry[text])
  }

  function handleSetCellText(unitId: string, position: CellPosition, text: string) {
    const before = getCell(state, unitId, position)?.text ?? ''
    if (before === text) return
    setStacks((st) => recordEdit(st, { kind: 'cell', unitId, position, before, after: text }))
    setState((s) => setCellText(s, unitId, position, text))
  }

  function handleSetTitle(title: string) {
    const before = state.mandala.title
    if (before === title) return
    setStacks((st) => recordEdit(st, { kind: 'title', before, after: title }))
    setState((s) => setTitle(s, title))
  }

  function handleUndo(): UndoEntry | undefined {
    const [entry, rest] = popUndo(stacks)
    if (!entry) return undefined
    setStacks(pushRedo(rest, entry))
    setState((s) => apply(s, entry, 'before'))
    return entry
  }

  function handleRedo(): UndoEntry | undefined {
    const [entry, rest] = popRedo(stacks)
    if (!entry) return undefined
    setStacks(pushUndo(rest, entry))
    setState((s) => apply(s, entry, 'after'))
    return entry
  }

  function handleReset() {
    if (!window.confirm('書いた内容をすべて消して、最初から始めますか？\n（このブラウザに保存した内容も消えます）')) return
    clearDemo()
    setStacks(emptyStacks)
    setState(createMandala(''))
  }

  return (
    <div className="app">
      <AppHeader
        right={
          <span className="mode-badge" title="架空のデータで試すモードです。内容はこのブラウザの中だけに保存され、どこにも送りません">
            体験モード
          </span>
        }
      />
      <MandalaEditor
        key={state.mandala.id}
        state={state}
        onSetCellText={handleSetCellText}
        onSetTitle={handleSetTitle}
        onUndo={handleUndo}
        onRedo={handleRedo}
        nextUndo={stacks.undo[stacks.undo.length - 1]}
        nextRedo={stacks.redo[stacks.redo.length - 1]}
        onSetColor={(color) => setState((s) => setMandalaColor(s, color))}
        footer={
          <div className="demo-tools">
            <button type="button" className="text-button" onClick={handleReset}>
              最初からやり直す
            </button>
          </div>
        }
      />
    </div>
  )
}

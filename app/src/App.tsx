import { CloudApp } from './components/CloudApp'
import { DemoApp } from './components/DemoApp'
import { isDemoMode } from './lib/config'

// 接続先がないとき、または URL に ?demo=1 があるときは体験モード（ブラウザの中だけで動く）。
// それ以外は、Google でログインして Supabase に保存する。
export default function App() {
  return isDemoMode ? <DemoApp /> : <CloudApp />
}

import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useState } from 'react'
import { finishSchoolLogin, getSession, isStudentSession, joinByLink, joinRoom, onAuthChange, signOut, startSchoolLogin } from '../lib/cloud'
import { isSchoolSession, isSchoolStudent, teacherSchoolOf, ticketFromHash } from '../lib/schoolLogin'
import { AppHeader } from './AppHeader'
import { CloudEditor } from './CloudEditor'
import { LoginScreen } from './LoginScreen'
import { MandalaListScreen } from './MandalaListScreen'

// ログインして使うときの入り口。
// アドレスで画面を決める：
//   ?m=<マンダラの番号>   … そのマンダラを開く（共有した人どうしで同じアドレスを使える）
//   ?join=<招待の合言葉> … 招待リンク。ログインしたあと参加して、そのマンダラを開く
//   ?room=<部屋の合言葉> … 生徒の部屋。合言葉を入れた状態で、入るところを出す
//   どれもない            … マンダラの一覧

function readParams() {
  const p = new URLSearchParams(window.location.search)
  return { mandalaId: p.get('m'), joinToken: p.get('join'), roomCode: p.get('room') ?? '' }
}

function displayName(session: Session): string {
  const meta = session.user.user_metadata as { full_name?: string; name?: string }
  return meta.full_name || meta.name || session.user.email || ''
}

export function CloudApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [params, setParams] = useState(readParams)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [roomBusy, setRoomBusy] = useState(false)
  const [roomError, setRoomError] = useState<string | null>(null)
  // 学校のアカウントで入る：学校の GAS から戻ってきたら、# のうしろの通行証で入る
  const [schoolTicket] = useState(() => ticketFromHash(window.location.hash))
  const [schoolBusy, setSchoolBusy] = useState(schoolTicket !== null)
  const [schoolError, setSchoolError] = useState<string | null>(null)
  useEffect(() => {
    if (!schoolTicket) return
    // 通行証は1回きり。アドレスからすぐ消す（履歴や画面に残さない）
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    let alive = true
    finishSchoolLogin(schoolTicket)
      .catch((e: unknown) => {
        if (alive) setSchoolError(e instanceof Error ? e.message : '学校のアカウントで入れませんでした')
      })
      .finally(() => {
        if (alive) setSchoolBusy(false)
      })
    return () => {
      alive = false
    }
  }, [schoolTicket])

  // 最後に入れた合言葉（入れなかったとき、打ち直さなくてよいように残す）
  const [lastRoomCode, setLastRoomCode] = useState('')

  useEffect(() => {
    let alive = true
    void getSession().then((s) => {
      if (alive) setSession(s)
    })
    const stop = onAuthChange((s) => setSession(s))
    const onPop = () => setParams(readParams())
    window.addEventListener('popstate', onPop)
    return () => {
      alive = false
      stop()
      window.removeEventListener('popstate', onPop)
    }
  }, [])

  const navigate = useCallback((mandalaId: string | null, replace = false) => {
    const url = mandalaId ? `/?m=${encodeURIComponent(mandalaId)}` : '/'
    if (replace) window.history.replaceState(null, '', url)
    else window.history.pushState(null, '', url)
    setParams({ mandalaId, joinToken: null, roomCode: '' })
  }, [])

  // 招待リンクから来たら、ログインのあとで参加する
  useEffect(() => {
    if (!session || !params.joinToken) return
    let alive = true
    joinByLink(params.joinToken)
      .then((id) => {
        if (alive) navigate(id, true)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setJoinError(e instanceof Error ? e.message : 'このリンクでは参加できませんでした')
        navigate(null, true)
      })
    return () => {
      alive = false
    }
  }, [session, params.joinToken, navigate])

  // 生徒が部屋の合言葉で入る。匿名ログインでログインの状態が変わっても、ここで最後まで見届ける
  async function handleJoinRoom(code: string, name: string) {
    setRoomBusy(true)
    setRoomError(null)
    setLastRoomCode(code)
    try {
      const id = await joinRoom(code, name)
      setLastRoomCode('')
      navigate(id)
    } catch (e) {
      setRoomError(e instanceof Error ? e.message : '部屋に入れませんでした')
    } finally {
      setRoomBusy(false)
    }
  }

  async function handleSignOut() {
    if (
      isStudentSession(session ?? null) &&
      !window.confirm(
        'ログアウトすると、同じ名前で入り直しても「別の人」になります（自分の書き込みの取り消しなどができなくなります）。書いた内容は残ります。\nログアウトしますか？',
      )
    )
      return
    await signOut()
    navigate(null, true)
  }

  const right = session ? (
    <span className="user-box">
      <span className="user-name">{displayName(session)}</span>
      <button type="button" className="text-button" onClick={handleSignOut}>
        ログアウト
      </button>
    </span>
  ) : null

  const student = isStudentSession(session ?? null)
  const schoolUser = isSchoolSession(session ?? null)
  const schoolStudent = isSchoolStudent(session ?? null)
  const schoolTeacher = teacherSchoolOf(session ?? null) !== null
  const roomForm = {
    initialCode: lastRoomCode || params.roomCode,
    initialName: (student || schoolUser) && session ? displayName(session) : '',
    busy: roomBusy,
    error: roomError,
    onSubmit: (code: string, name: string) => void handleJoinRoom(code, name),
  }

  let body
  if (roomBusy || schoolBusy) {
    body = (
      <main className="app-main">
        <p className="muted">{schoolBusy ? '学校のアカウントを確かめています…' : '部屋に入っています…'}</p>
      </main>
    )
  } else if (session === undefined) {
    body = (
      <main className="app-main">
        <p className="muted">読み込んでいます…</p>
      </main>
    )
  } else if (session === null) {
    body = (
      <LoginScreen
        invited={params.joinToken !== null}
        roomForm={roomForm}
        school={{ busy: schoolBusy, error: schoolError, onStart: startSchoolLogin }}
      />
    )
  } else if (params.joinToken) {
    body = (
      <main className="app-main">
        <p className="muted">招待されたマンダラに参加しています…</p>
      </main>
    )
  } else if (params.mandalaId) {
    body = (
      <CloudEditor
        key={params.mandalaId}
        mandalaId={params.mandalaId}
        userId={session.user.id}
        userName={displayName(session)}
        student={isStudentSession(session) || isSchoolStudent(session)}
        onBack={() => navigate(null)}
      />
    )
  } else {
    body = (
      <>
        {joinError && (
          <p className="notice notice-top" role="alert">
            {joinError}
          </p>
        )}
        <MandalaListScreen
          userId={session.user.id}
          student={student}
          canJoinRoom={student || schoolStudent}
          schoolName={schoolUser ? displayName(session) : undefined}
          schoolTeacher={schoolTeacher}
          roomForm={roomForm}
          onOpen={(id) => navigate(id)}
        />
      </>
    )
  }

  return (
    <div className="app">
      <AppHeader right={right} onHome={session ? () => navigate(null) : undefined} />
      {body}
    </div>
  )
}

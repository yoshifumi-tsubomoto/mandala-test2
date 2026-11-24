import { useState } from 'react'
import { signInWithGoogle } from '../lib/cloud'
import { APP_NAME, SCHOOL_LOGIN_URL } from '../lib/config'
import { RoomJoinForm } from './RoomJoinForm'

interface Props {
  /** 招待リンクから来たとき true（説明の文を変える） */
  invited: boolean
  /** 生徒が部屋の合言葉で入るところ */
  roomForm: Parameters<typeof RoomJoinForm>[0]
  /** 学校のアカウントで入る（学校の GAS があるときだけ） */
  school: { busy: boolean; error: string | null; onStart: () => void }
}

// ログインしていないときの最初の画面
export function LoginScreen({ invited, roomForm, school }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleLogin() {
    setBusy(true)
    setError(null)
    try {
      await signInWithGoogle()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ログインを始められませんでした')
      setBusy(false)
    }
  }

  return (
    <main className="app-main login">
      <h2 className="login-title">{APP_NAME}</h2>
      <p className="login-lead">
        3×3 のマスを入れ子にして、考えを深く・広く掘り下げます。クラスや班で、同じマンダラを一緒に書けます。
      </p>
      {invited && (
        <p className="notice" role="status">
          マンダラに招待されています。ログインすると参加できます。
        </p>
      )}

      <div className="login-choices">
        {/* 左の列：生徒の人 */}
        <div className="login-column" role="group" aria-labelledby="login-col-student">
          <h3 id="login-col-student" className="login-column-title">
            生徒の人
          </h3>
          {SCHOOL_LOGIN_URL && (
            <section className="login-box login-box-school" aria-labelledby="login-school">
              <h4 id="login-school" className="login-box-title">
                学校のアカウントで入る<span className="login-badge">おすすめ</span>
              </h4>
              <ul className="login-merits">
                <li>どの Chromebook からでも、同じ人として続きが書ける</li>
                <li>自分のマンダラを作れる</li>
                <li>先生が開いた部屋にも、合言葉で入れる</li>
              </ul>
              <button type="button" className="primary-button" onClick={school.onStart} disabled={school.busy}>
                {school.busy ? '確かめています…' : '学校のアカウントで入る'}
              </button>
              <p className="muted room-note">学校のページが開くので、「マンダラ発想法へ進む」を押してください。</p>
              {school.error && (
                <p className="error-text" role="alert">
                  {school.error}
                </p>
              )}
            </section>
          )}

          <section className="login-box" aria-labelledby="login-student">
            <h4 id="login-student" className="login-box-title">
              {SCHOOL_LOGIN_URL ? '部屋の合言葉だけで入る' : '部屋の合言葉で入る'}
            </h4>
            {SCHOOL_LOGIN_URL && (
              <ul className="login-limits">
                <li>この Chromebook のこのブラウザだけ（別の端末やログアウトのあとは「別の人」になる）</li>
                <li>先生が開いた部屋のマンダラに書けるだけ（自分のマンダラは作れない）</li>
                <li>学校のアカウントが使えないとき、ほかの学校の人と使うときに</li>
              </ul>
            )}
            <RoomJoinForm {...roomForm} />
          </section>
        </div>

        {/* 右の列：先生・大人の人 */}
        <div className="login-column" role="group" aria-labelledby="login-col-teacher">
          <h3 id="login-col-teacher" className="login-column-title">
            先生・大人の人
          </h3>
          {SCHOOL_LOGIN_URL && (
            <section className="login-box" aria-labelledby="login-teacher-school">
              <h4 id="login-teacher-school" className="login-box-title">
                学校のアカウントで入る
              </h4>
              <p className="muted">先生として登録された人は、学校の生徒が作ったマンダラを全部見られます。部屋を開くこともできます。</p>
              <button type="button" className="primary-button" onClick={school.onStart} disabled={school.busy}>
                {school.busy ? '確かめています…' : '学校のアカウントで入る'}
              </button>
            </section>
          )}

          <section className="login-box" aria-labelledby="login-teacher">
            <h4 id="login-teacher" className="login-box-title">
              {SCHOOL_LOGIN_URL ? 'Google でログイン（個人のアカウント）' : 'Google でログイン'}
            </h4>
            <p className="muted">
              マンダラを作ったり、生徒の部屋を開いたりできます。
              {SCHOOL_LOGIN_URL && '学校の生徒が作ったマンダラは見えません。'}
            </p>
            <button type="button" className="primary-button" onClick={handleLogin} disabled={busy}>
              {busy ? 'Google に移動しています…' : 'Google でログイン'}
            </button>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
          </section>
        </div>
      </div>

      <div className="login-sub">
        <a href="/?demo=1">ログインせずに試す（体験モード）</a>
        <span aria-hidden="true">・</span>
        <a href="/privacy.html">プライバシーポリシー</a>
      </div>
    </main>
  )
}

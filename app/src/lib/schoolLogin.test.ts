import { describe, expect, it } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { isSchoolSession, isSchoolStudent, newSchoolState, schoolLoginUrl, teacherSchoolOf, ticketFromHash } from './schoolLogin'

describe('学校のアカウントで入る', () => {
  it('画面の番号は32文字の英数字・-・_で、毎回ちがう', () => {
    const a = newSchoolState()
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(newSchoolState()).not.toBe(a)
  })
  it('学校の GAS を開くアドレスに、戻り先と画面の番号をつける', () => {
    const u = new URL(schoolLoginUrl('https://script.google.com/macros/s/DUMMY/exec', 'https://example.app/', 'S'.repeat(32)))
    expect(u.searchParams.get('return')).toBe('https://example.app/')
    expect(u.searchParams.get('state')).toBe('S'.repeat(32))
  })
  it('戻ってきたアドレスの # から通行証を取り出す', () => {
    expect(ticketFromHash('#ticket=abc.def')).toBe('abc.def')
    expect(ticketFromHash('#ticket=a%2Bb.c')).toBe('a+b.c')
    expect(ticketFromHash('')).toBeNull()
    expect(ticketFromHash('#other=1')).toBeNull()
    expect(ticketFromHash('#ticket=' + 'x'.repeat(2001))).toBeNull()
  })
  it('学校の生徒かは app_metadata.school で見分ける', () => {
    const s = (meta: object) => ({ user: { app_metadata: meta } }) as unknown as Session
    expect(isSchoolSession(s({ school: 'school.example' }))).toBe(true)
    expect(isSchoolSession(s({}))).toBe(false)
    expect(isSchoolSession(null)).toBe(false)
  })
  it('先生は school_role が teacher のときだけ。ないときは生徒', () => {
    const s = (meta: object) => ({ user: { app_metadata: meta } }) as unknown as Session
    expect(teacherSchoolOf(s({ school: 'school.example', school_role: 'teacher' }))).toBe('school.example')
    expect(teacherSchoolOf(s({ school: 'school.example', school_role: 'student' }))).toBeNull()
    expect(teacherSchoolOf(s({ school: 'school.example' }))).toBeNull()
    expect(teacherSchoolOf(s({ school_role: 'teacher' }))).toBeNull()
    expect(isSchoolStudent(s({ school: 'school.example' }))).toBe(true)
    expect(isSchoolStudent(s({ school: 'school.example', school_role: 'teacher' }))).toBe(false)
  })
})

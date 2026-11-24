import { describe, expect, it } from 'vitest'
import { PERSON_COLORS, colorForUser, editorsByPosition, initialOf, mergeOthers, nextFreeAfter, othersFrom, parseWhere, type PresenceInfo, type WhereInfo } from './presence'

const p = (tabId: string, name: string, unitId: string | null, position: PresenceInfo['position']): PresenceInfo => ({
  tabId,
  userId: `user-${name}`,
  name,
  unitId,
  position,
  at: 1,
})

describe('Presence の中身を一覧にする', () => {
  it('自分の画面を除き、名前の順に並べる', () => {
    const state = {
      'user-a': [p('tab-a', 'ダミーA', 'u1', 1)],
      'user-b': [p('tab-b1', 'ダミーB', 'u1', 2), p('tab-b2', 'ダミーB', 'u2', null)],
      'user-me': [p('tab-me', 'ダミー自分', 'u1', 3)],
    }
    expect(othersFrom(state, 'tab-me').map((o) => o.tabId)).toEqual(['tab-a', 'tab-b1', 'tab-b2'])
  })

  it('形のおかしい中身は捨てる。途中の文字は500文字まで', () => {
    const state = {
      x: [{ tabId: 1 }, { tabId: 't', userId: 'u', name: 'ダミー', position: 9, draft: 'あ'.repeat(600) }],
    }
    const list = othersFrom(state as never, 'me')
    expect(list).toHaveLength(1)
    expect(list[0].position).toBeNull()
    expect(list[0].draft).toHaveLength(500)
  })
})

describe('在席（名前）と、どこを触っているか（where）を重ねる', () => {
  const who = (tabId: string, name: string) => ({ tabId, userId: `user-${name}`, name, at: 1 })
  it('where があれば、ユニット・マス・途中の文字を重ねる', () => {
    const state = { a: [who('tab-a', 'ダミーA')], b: [who('tab-b', 'ダミーB')] }
    const where = new Map<string, WhereInfo>([['tab-a', { tabId: 'tab-a', unitId: 'u1', position: 4, draft: 'あ', at: 5 }]])
    const list = mergeOthers(state, where, 'me')
    expect(list[0]).toMatchObject({ name: 'ダミーA', unitId: 'u1', position: 4, draft: 'あ', at: 5 })
    expect(list[1]).toMatchObject({ name: 'ダミーB', unitId: null, position: null })
  })
  it('在席にいない画面の where は使わない', () => {
    const where = new Map<string, WhereInfo>([['tab-x', { tabId: 'tab-x', unitId: 'u1', position: 1, at: 1 }]])
    expect(mergeOthers({}, where, 'me')).toEqual([])
  })
  it('where の形を確かめる', () => {
    expect(parseWhere(null)).toBeNull()
    expect(parseWhere({ tabId: 3 })).toBeNull()
    expect(parseWhere({ tabId: 't', unitId: 'u', position: 9, draft: '' })).toEqual({ tabId: 't', unitId: 'u', position: null, draft: undefined, at: 0 })
    expect(parseWhere({ tabId: 't', position: 'center', draft: 'い'.repeat(600) })?.draft).toHaveLength(500)
  })
})

describe('ほかの人が書いているマス', () => {
  it('同じユニットの、書いているマスだけを集める', () => {
    const others = [p('1', 'ダミーA', 'u1', 3), p('2', 'ダミーB', 'u1', 3), p('3', 'ダミーC', 'u2', 3), p('4', 'ダミーD', 'u1', null)]
    const map = editorsByPosition(others, 'u1')
    expect(map.get(3)?.map((o) => o.name)).toEqual(['ダミーA', 'ダミーB'])
    expect(map.size).toBe(1)
  })

  it('時計回りで次のマスを探すとき、ほかの人のマスは飛ばす', () => {
    expect(nextFreeAfter(1, new Set())).toBe(2)
    expect(nextFreeAfter(1, new Set([2, 3]))).toBe(4)
    expect(nextFreeAfter(8, new Set([1]))).toBe(2)
    expect(nextFreeAfter(1, new Set([2, 3, 4, 5, 6, 7, 8]))).toBeNull()
  })
})

describe('人ごとの色と頭文字', () => {
  it('同じ人はいつも同じ色、ちがう人はたいていちがう色', () => {
    expect(colorForUser('user-a')).toBe(colorForUser('user-a'))
    expect(colorForUser('user-a')).not.toBe(colorForUser('user-b'))
    expect(PERSON_COLORS).toContain(colorForUser('user-a'))
    // 似た名前の人どうしでも、色がばらける
    const colors = new Set(['user-a', 'user-b', 'user-c', 'user-d', 'user-e'].map(colorForUser))
    expect(colors.size).toBeGreaterThanOrEqual(4)
  })

  it('頭文字', () => {
    expect(initialOf(' ダミーA')).toBe('ダ')
    expect(initialOf('')).toBe('?')
  })
})

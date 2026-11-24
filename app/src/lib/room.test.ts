import { describe, expect, it } from 'vitest'
import { formatRoomCode, isRoomCode, normalizeRoomCode, normalizeRoomName } from './room'

describe('部屋の合言葉', () => {
  it('小文字・ハイフン・空白・全角でも、送る形にそろえる', () => {
    expect(normalizeRoomCode('k7p-4mx')).toBe('K7P4MX')
    expect(normalizeRoomCode(' K7P 4MX ')).toBe('K7P4MX')
    expect(normalizeRoomCode('Ｋ７Ｐ－４ＭＸ')).toBe('K7P4MX')
  })
  it('6文字で、使う文字だけなら正しい', () => {
    expect(isRoomCode('K7P4MX')).toBe(true)
    expect(isRoomCode('K7P4M')).toBe(false)
    expect(isRoomCode('K7P4M0')).toBe(false) // 0 は使わない
    expect(isRoomCode('KIP4MX')).toBe(false) // I は使わない
  })
  it('見せるときは3文字ずつ区切る', () => {
    expect(formatRoomCode('k7p4mx')).toBe('K7P-4MX')
    expect(formatRoomCode('K7')).toBe('K7')
  })
})

describe('部屋で使う表示名', () => {
  it('前後の空白を消し、1〜20文字なら使える', () => {
    expect(normalizeRoomName('  ダミーA ')).toBe('ダミーA')
    expect(normalizeRoomName('   ')).toBeNull()
    expect(normalizeRoomName('あ'.repeat(20))).toBe('あ'.repeat(20))
    expect(normalizeRoomName('あ'.repeat(21))).toBeNull()
  })
})

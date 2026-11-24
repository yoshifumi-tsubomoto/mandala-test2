// 生徒の「部屋の合言葉」の、通信しない部分（テストあり）。
// 合言葉は6文字。読みまちがえやすい文字（0 O 1 I）は使わない（SQL 008 の private.new_room_code と同じ）

export const ROOM_CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const ROOM_CODE_LENGTH = 6
export const ROOM_NAME_MAX = 20

/** 打った合言葉を、送る形にそろえる（小文字→大文字、ハイフンや空白は消す） */
export function normalizeRoomCode(input: string): string {
  return input
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
}

/** 合言葉として正しい形か（6文字で、使う文字だけ） */
export function isRoomCode(code: string): boolean {
  return code.length === ROOM_CODE_LENGTH && [...code].every((ch) => ROOM_CODE_LETTERS.includes(ch))
}

/** 見せるときの形（3文字ずつ区切る。例：K7P-4MX） */
export function formatRoomCode(code: string): string {
  const c = normalizeRoomCode(code)
  return c.length > 3 ? `${c.slice(0, 3)}-${c.slice(3)}` : c
}

/** 表示名をそろえる（前後の空白を消す）。使えなければ null */
export function normalizeRoomName(input: string): string | null {
  const n = input.trim()
  const len = Array.from(n).length
  return len >= 1 && len <= ROOM_NAME_MAX ? n : null
}

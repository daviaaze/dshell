export function toArray<T>(list: any): T[] {
  if (!list) return []
  if (Array.isArray(list)) return list
  const arr: T[] = []
  let l = list
  while (l) {
    const item = l.data !== undefined ? l.data : l
    if (item !== undefined && item !== null) {
      arr.push(item)
    }
    l = l.next
  }
  return arr
}

export function listLength(list: any): number {
  if (!list) return 0
  if (Array.isArray(list)) return list.length
  let count = 0
  let l = list
  while (l) {
    count++
    l = l.next
  }
  return count
}

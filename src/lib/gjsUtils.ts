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


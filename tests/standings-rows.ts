export function conference(tag: string, length = 10): string[] {
  return Array.from({ length }, (_, index) => `${index + 1} ${tag}${index} Team ${60 - index}-${22 + index} ${index === 0 ? '—' : index}`);
}

export function fullTables(lengths: [number, number] = [10, 10]): [string[], string[]] {
  return [conference('E', lengths[0]), conference('W', lengths[1])];
}

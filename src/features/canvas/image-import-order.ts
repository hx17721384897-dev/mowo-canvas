export function imageImportOrder(names: string[]) {
  if (names.length < 2) return null;
  const parsed = names.map((name) => {
    const stem = name.replace(/\.[^.]+$/, "");
    const match = /^(.*?)(\d+)$/.exec(stem);
    return match ? { prefix: match[1].toLocaleLowerCase(), number: BigInt(match[2]) } : null;
  });
  if (parsed.some((item) => !item) || parsed.some((item) => item!.prefix !== parsed[0]!.prefix)) return null;
  if (new Set(parsed.map((item) => item!.number.toString())).size !== names.length) return null;
  return names.map((_, index) => index).sort((a, b) => parsed[a]!.number < parsed[b]!.number ? -1 : 1);
}

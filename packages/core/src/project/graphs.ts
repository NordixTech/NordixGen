/** Dependencies name prerequisites; ties are sorted without changing declared input arrays. */
export function dependencyOrder(
  nodes: readonly string[],
  dependencies: ReadonlyMap<string, readonly string[]>,
): { order: string[]; cycle: string[] } {
  const order: string[] = [];
  const remaining = new Map(
    nodes.map((name) => [name, new Set(dependencies.get(name) as readonly string[])]),
  );
  const ready = nodes.filter((name) => (remaining.get(name) as Set<string>).size === 0).sort();
  while (ready.length) {
    const name = ready.shift() as string;
    order.push(name);
    remaining.delete(name);
    for (const [dependent, required] of remaining) {
      if (required.delete(name) && required.size === 0) ready.push(dependent);
    }
    ready.sort();
  }
  if (order.length === nodes.length) return { order, cycle: [] };
  const complete = new Set<string>();
  const active: string[] = [];
  let cycle: string[] = [];
  const visit = (name: string): boolean => {
    const at = active.indexOf(name);
    if (at >= 0) {
      cycle = [...active.slice(at), name];
      return false;
    }
    if (complete.has(name)) return true;
    active.push(name);
    for (const dependency of [...(dependencies.get(name) as readonly string[])].sort())
      if (!visit(dependency)) return false;
    active.pop();
    complete.add(name);
    return true;
  };
  for (const name of [...remaining.keys()].sort()) if (!visit(name)) break;
  return { order, cycle };
}

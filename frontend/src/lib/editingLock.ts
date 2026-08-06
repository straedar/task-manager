/** Counts open edit/create dialogs so polling can pause while the user is typing. */
let depth = 0;

export function beginEditing(): void {
  depth += 1;
}

export function endEditing(): void {
  depth = Math.max(0, depth - 1);
}

export function isEditing(): boolean {
  return depth > 0;
}

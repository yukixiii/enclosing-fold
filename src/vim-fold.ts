/** A folded range in document offsets, as CodeMirror reports it. */
export interface Fold {
	from: number;
	to: number;
}

/**
 * Where a vim normal-mode cursor at `head` should go instead, or null if it is
 * fine where it is.
 *
 * A cursor at the end of a folded range (`from < head <= to`) is drawn at the
 * right edge of the folded line, but vim computes motions on the hidden line
 * it is really on, and CodeMirror pushes the result back to the fold's end:
 * h/l/k look stuck. Move it to the last character of the fold's first line,
 * which is where it appears to be, as Vim keeps the cursor on a closed fold's
 * first line.
 */
export function normalTarget(
	folds: readonly Fold[],
	head: number,
	lineFrom: (pos: number) => number,
): number | null {
	let outer: Fold | null = null;
	for (const f of folds) {
		if (f.from < head && head <= f.to && (!outer || f.from < outer.from)) outer = f;
	}
	return outer ? Math.max(lineFrom(outer.from), outer.from - 1) : null;
}

/** The fold that starts exactly at `pos` (the end of a folded line), if any. */
export function foldStartingAt(folds: readonly Fold[], pos: number): Fold | null {
	return folds.find((f) => f.from === pos) ?? null;
}

/** Every fold ending at `to`, including nested ones that share the same end. */
export function foldsEndingAt(folds: readonly Fold[], to: number): Fold[] {
	return folds.filter((f) => f.to === to);
}

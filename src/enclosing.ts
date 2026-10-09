/** A foldable range, in 1-based line numbers. */
export interface LineRange {
	fromLine: number;
	toLine: number;
}

/**
 * Find the innermost unfolded range that contains `cursorLine`.
 *
 * Walks upward from the cursor line and returns the first line whose
 * foldable range reaches down to the cursor and is not already folded.
 * Skipping folded ranges makes repeated calls climb to the parent section.
 */
export function findEnclosing(
	cursorLine: number,
	foldableAt: (line: number) => LineRange | null,
	isFolded: (line: number) => boolean,
): LineRange | null {
	for (let n = cursorLine; n >= 1; n--) {
		const r = foldableAt(n);
		if (r && r.toLine >= cursorLine && !isFolded(n)) return r;
	}
	return null;
}

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s/;

/** Whether `text` is a list item line (bullet, numbered or task). */
export function isListLine(text: string): boolean {
	return LIST_ITEM.test(text);
}

/** All foldable ranges that start within `fromLine`..`toLine`, in line order. */
export function rangesWithin(
	fromLine: number,
	toLine: number,
	foldableAt: (line: number) => LineRange | null,
): LineRange[] {
	const ranges: LineRange[] = [];
	for (let n = fromLine; n <= toLine; n++) {
		const r = foldableAt(n);
		if (r) ranges.push(r);
	}
	return ranges;
}

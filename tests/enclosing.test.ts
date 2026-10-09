import { describe, expect, it } from "vitest";
import { findEnclosing, isListLine, rangesWithin, type LineRange } from "../src/enclosing";

// Ranges Obsidian reports for the note used in manual testing:
// "# Top" 1-18, "## Section A" 5-14, "- item 1" 10-12, "## Section B" 15-18.
const RANGES: Record<number, LineRange> = {
	1: { fromLine: 1, toLine: 18 },
	5: { fromLine: 5, toLine: 14 },
	10: { fromLine: 10, toLine: 12 },
	15: { fromLine: 15, toLine: 18 },
};
const foldableAt = (n: number) => RANGES[n] ?? null;

function enclosing(cursorLine: number, folded: number[] = []): number | undefined {
	return findEnclosing(cursorLine, foldableAt, (n) => folded.includes(n))?.fromLine;
}

describe("findEnclosing", () => {
	it("finds the section around a body line", () => {
		expect(enclosing(7)).toBe(5);
		expect(enclosing(17)).toBe(15);
	});

	it("prefers the innermost range", () => {
		expect(enclosing(11)).toBe(10);
	});

	it("skips a range that ends above the cursor", () => {
		expect(enclosing(13)).toBe(5);
	});

	it("uses the range starting on the cursor line", () => {
		expect(enclosing(5)).toBe(5);
		expect(enclosing(10)).toBe(10);
	});

	it("climbs to the parent when the inner range is folded", () => {
		expect(enclosing(10, [10])).toBe(5);
		expect(enclosing(5, [10, 5])).toBe(1);
	});

	it("returns null when nothing encloses the cursor", () => {
		expect(enclosing(1, [1])).toBeUndefined();
		expect(findEnclosing(3, () => null, () => false)).toBeNull();
	});
});

describe("isListLine", () => {
	it("matches bullet, numbered and task items", () => {
		for (const text of ["- a", "* a", "+ a", "  - nested", "\t- tab", "1. a", "10) a", "- [ ] task", "- [x] done"]) {
			expect(isListLine(text)).toBe(true);
		}
	});

	it("does not match headings or plain text", () => {
		for (const text of ["# Top", "## Section", "text", "-no space", "---", "1.5 km"]) {
			expect(isListLine(text)).toBe(false);
		}
	});
});

describe("rangesWithin", () => {
	const starts = (from: number, to: number) => rangesWithin(from, to, foldableAt).map((r) => r.fromLine);

	it("lists every range starting inside the span, in order", () => {
		expect(starts(5, 14)).toEqual([5, 10]);
		expect(starts(1, 18)).toEqual([1, 5, 10, 15]);
	});

	it("returns nothing for a span without ranges", () => {
		expect(starts(2, 4)).toEqual([]);
	});
});

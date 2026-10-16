import { describe, expect, it } from "vitest";
import { foldStartingAt, foldsEndingAt, normalTarget } from "../src/vim-fold";

// "# Head A\nbody a1\nbody a2\n\n## Sub\nsub line\n\n# Head B\nbody b1\n"
// with "# Head A" (8-42) and "## Sub" (32-42) folded.
const DOC = "# Head A\nbody a1\nbody a2\n\n## Sub\nsub line\n\n# Head B\nbody b1\n";
const lineFrom = (pos: number) => DOC.lastIndexOf("\n", pos - 1) + 1;
const OUTER = { from: 8, to: 42 };
const INNER = { from: 32, to: 42 };

describe("normalTarget", () => {
	it("moves a cursor at the fold's end to the folded line's last character", () => {
		expect(normalTarget([OUTER], 42, lineFrom)).toBe(7);
	});

	it("uses the outermost fold when folds are nested", () => {
		expect(normalTarget([OUTER, INNER], 42, lineFrom)).toBe(7);
	});

	it("leaves a cursor on the folded line itself alone", () => {
		expect(normalTarget([OUTER], 7, lineFrom)).toBeNull();
		expect(normalTarget([OUTER], 8, lineFrom)).toBeNull();
	});

	it("leaves a cursor after the fold alone", () => {
		expect(normalTarget([OUTER], 43, lineFrom)).toBeNull();
	});

	it("stays at the line start when the folded line has no text before the fold", () => {
		expect(normalTarget([{ from: 0, to: 5 }], 5, () => 0)).toBe(0);
	});
});

describe("foldStartingAt / foldsEndingAt", () => {
	it("finds the fold starting at a line end", () => {
		expect(foldStartingAt([OUTER, INNER], 8)).toEqual(OUTER);
		expect(foldStartingAt([OUTER, INNER], 7)).toBeNull();
	});

	it("collects every fold sharing an end", () => {
		expect(foldsEndingAt([OUTER, INNER, { from: 50, to: 60 }], 42)).toEqual([OUTER, INNER]);
	});
});

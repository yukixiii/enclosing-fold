import { Editor, Plugin } from "obsidian";
import { foldable, foldedRanges, foldEffect, unfoldEffect } from "@codemirror/language";
import type { EditorState, StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { findEnclosing, isListLine, rangesWithin, type LineRange } from "./enclosing";

interface Range {
	from: number;
	to: number;
}

/** Foldable range starting on line `n` (1-based). */
function foldableOnLine(state: EditorState, n: number): Range | null {
	const line = state.doc.line(n);
	return foldable(state, line.from, line.to);
}

/** The fold that starts on line `n`, if that line is folded. */
function foldOnLine(state: EditorState, n: number): Range | null {
	const line = state.doc.line(n);
	let found: Range | null = null;
	foldedRanges(state).between(line.from, line.to, (from, to) => {
		if (state.doc.lineAt(from).number === n) {
			found = { from, to };
			return false;
		}
	});
	return found;
}

/** Foldable range starting on line `n`, in line numbers. */
function lineRangeOn(state: EditorState, n: number): LineRange | null {
	const r = foldableOnLine(state, n);
	return r ? { fromLine: n, toLine: state.doc.lineAt(r.to).number } : null;
}

function cursorLine(view: EditorView): number {
	return view.state.doc.lineAt(view.state.selection.main.head).number;
}

/**
 * Fold the innermost unfolded section around the cursor.
 * The cursor moves to the start of the section's first line so that it sits
 * outside the folded range; otherwise Obsidian unfolds it again at once.
 */
function foldEnclosing(editor: Editor, view: EditorView): void {
	const state = view.state;
	const found = findEnclosing(
		cursorLine(view),
		(n) => lineRangeOn(state, n),
		(n) => foldOnLine(state, n) !== null,
	);
	if (!found) return;
	const range = foldableOnLine(state, found.fromLine);
	if (!range) return;
	// Move through the Editor API first so vim mode tracks the new position too.
	editor.setCursor({ line: found.fromLine - 1, ch: 0 });
	view.dispatch({ effects: foldEffect.of(range) });
}

/** Unfold the fold starting on the cursor line. Returns false if there is none. */
function unfoldHere(view: EditorView): boolean {
	const fold = foldOnLine(view.state, cursorLine(view));
	if (!fold) return false;
	view.dispatch({ effects: unfoldEffect.of(fold) });
	return true;
}

/**
 * Fold the innermost section around the cursor and every foldable range in it.
 * Unlike `foldEnclosing`, an already folded section is still the target.
 */
function foldRecursive(editor: Editor, view: EditorView): void {
	const state = view.state;
	const found = findEnclosing(cursorLine(view), (n) => lineRangeOn(state, n), () => false);
	if (!found) return;
	const effects = rangesWithin(found.fromLine, found.toLine, (n) => lineRangeOn(state, n))
		.filter((r) => foldOnLine(state, r.fromLine) === null)
		.map((r) => foldEffect.of(foldableOnLine(state, r.fromLine)!));
	editor.setCursor({ line: found.fromLine - 1, ch: 0 });
	if (effects.length > 0) view.dispatch({ effects });
}

/**
 * Unfold every fold inside the fold on the cursor line, or, if that line is
 * not folded, inside the innermost section around the cursor.
 */
function unfoldRecursive(view: EditorView): void {
	const state = view.state;
	let target = foldOnLine(state, cursorLine(view));
	if (!target) {
		const found = findEnclosing(cursorLine(view), (n) => lineRangeOn(state, n), () => false);
		if (!found) return;
		target = foldableOnLine(state, found.fromLine);
		if (!target) return;
	}
	const start = state.doc.lineAt(target.from).from;
	const effects: StateEffect<Range>[] = [];
	foldedRanges(state).between(start, target.to, (from, to) => {
		if (from >= start) effects.push(unfoldEffect.of({ from, to }));
	});
	if (effects.length > 0) view.dispatch({ effects });
}

function isHeadingFoldLine(state: EditorState, n: number): boolean {
	return !isListLine(state.doc.line(n).text);
}

/** Fold every non-list (heading) section in the note. List folds are left as they are. */
function foldHeadings(editor: Editor, view: EditorView): void {
	const state = view.state;
	const cursor = cursorLine(view);
	const headings = rangesWithin(1, state.doc.lines, (n) =>
		isHeadingFoldLine(state, n) ? lineRangeOn(state, n) : null,
	);
	if (headings.length === 0) return;
	const effects = headings
		.filter((r) => foldOnLine(state, r.fromLine) === null)
		.map((r) => foldEffect.of(foldableOnLine(state, r.fromLine)!));
	// Keep the cursor out of the folded ranges, or Obsidian unfolds them again.
	const outer = headings.find((r) => r.fromLine < cursor && cursor <= r.toLine);
	if (outer) editor.setCursor({ line: outer.fromLine - 1, ch: 0 });
	if (effects.length > 0) view.dispatch({ effects });
}

/** Unfold every heading fold in the note, keeping list folds. */
function unfoldHeadings(view: EditorView): void {
	const state = view.state;
	const effects: StateEffect<Range>[] = [];
	foldedRanges(state).between(0, state.doc.length, (from, to) => {
		if (isHeadingFoldLine(state, state.doc.lineAt(from).number)) {
			effects.push(unfoldEffect.of({ from, to }));
		}
	});
	if (effects.length > 0) view.dispatch({ effects });
}

export default class EnclosingFoldPlugin extends Plugin {
	async onload(): Promise<void> {
		this.addCommand({
			id: "fold",
			name: "Fold section around cursor",
			editorCallback: (editor) => this.withView(editor, (view) => foldEnclosing(editor, view)),
		});
		this.addCommand({
			id: "unfold",
			name: "Unfold section at cursor",
			editorCallback: (editor) => this.withView(editor, (view) => unfoldHere(view)),
		});
		this.addCommand({
			id: "toggle",
			name: "Toggle fold of section around cursor",
			editorCallback: (editor) =>
				this.withView(editor, (view) => {
					if (!unfoldHere(view)) foldEnclosing(editor, view);
				}),
		});
		this.addCommand({
			id: "fold-recursive",
			name: "Fold section around cursor recursively",
			editorCallback: (editor) => this.withView(editor, (view) => foldRecursive(editor, view)),
		});
		this.addCommand({
			id: "unfold-recursive",
			name: "Unfold section around cursor recursively",
			editorCallback: (editor) => this.withView(editor, (view) => unfoldRecursive(view)),
		});
		this.addCommand({
			id: "fold-headings",
			name: "Fold all headings",
			editorCallback: (editor) => this.withView(editor, (view) => foldHeadings(editor, view)),
		});
		this.addCommand({
			id: "unfold-headings",
			name: "Unfold all headings",
			editorCallback: (editor) => this.withView(editor, (view) => unfoldHeadings(view)),
		});
	}

	private withView(editor: Editor, run: (view: EditorView) => void): void {
		// `Editor.cm` is the CodeMirror 6 view; it is not in the public typings.
		const view = (editor as Editor & { cm?: EditorView }).cm;
		if (view) run(view);
	}
}

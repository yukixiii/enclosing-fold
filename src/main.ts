import { Editor, editorInfoField, Plugin } from "obsidian";
import { foldable, foldedRanges, foldEffect, unfoldEffect } from "@codemirror/language";
import { EditorSelection, EditorState, type StateEffect, type Transaction, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { findEnclosing, isListLine, rangesWithin, type LineRange } from "./enclosing";
import { foldStartingAt, foldsEndingAt, normalTarget, type Fold } from "./vim-fold";

/** The parts of Obsidian's CodeMirror 5 adapter (vim's `cm`) used here. */
interface VimState {
	insertMode?: boolean;
	visualMode?: boolean;
}
interface AdapterCm {
	cm6: EditorView;
	state: { vim?: VimState };
	setCursor(pos: unknown): void;
	posFromIndex(offset: number): unknown;
}
type AdapterCommand = (cm: AdapterCm) => unknown;

declare global {
	interface Window {
		CodeMirrorAdapter?: { commands?: Record<string, AdapterCommand | undefined> };
	}
}

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

function allFolds(state: EditorState): Fold[] {
	const folds: Fold[] = [];
	foldedRanges(state).between(0, state.doc.length, (from, to) => {
		folds.push({ from, to });
	});
	return folds;
}

/** The vim state of the editor a transaction belongs to, if vim mode is on. */
function vimOf(tr: Transaction): VimState | undefined {
	const editor = tr.startState.field(editorInfoField, false)?.editor as
		| (Editor & { cm?: EditorView & { cm?: AdapterCm } })
		| undefined;
	return editor?.cm?.cm?.state.vim;
}

/**
 * Keep the vim normal-mode cursor off the hidden end of a folded range, where
 * h/l/k cannot move it (see `normalTarget`).
 */
const normalCursorOffFoldEnd = EditorState.transactionFilter.of((tr) => {
	if (!tr.selection) return tr;
	const sel = tr.selection.main;
	if (!sel.empty) return tr;
	const vim = vimOf(tr);
	if (!vim || vim.insertMode || vim.visualMode) return tr;
	const state = tr.state;
	const target = normalTarget(allFolds(state), sel.head, (pos) => state.doc.lineAt(pos).from);
	if (target === null) return tr;
	const fix: TransactionSpec = { selection: EditorSelection.cursor(target), sequential: true };
	return [tr, fix];
});

/**
 * Make vim's `o` on a folded line open the new line below the fold, as Vim
 * does. vim.js moves the cursor to the end of the line (where the fold starts)
 * and then runs the adapter's `newlineAndIndent`; this moves the cursor on to
 * the end of the fold first. The change at the fold's end makes CodeMirror
 * drop the fold, so it is folded again afterwards.
 */
function wrapNewline(orig: AdapterCommand): AdapterCommand {
	return function (this: unknown, cm: AdapterCm) {
		const view = cm.cm6;
		const state = view?.state;
		if (!state || !cm.state.vim?.insertMode || !state.selection.main.empty) {
			return orig.call(this, cm);
		}
		const folds = allFolds(state);
		const fold = foldStartingAt(folds, state.selection.main.head);
		if (!fold) return orig.call(this, cm);
		const keep = foldsEndingAt(folds, fold.to);
		cm.setCursor(cm.posFromIndex(fold.to));
		const result = orig.call(this, cm);
		// The new text goes after `fold.to`, so the kept ranges keep their offsets.
		const now = allFolds(view.state);
		const effects = keep
			.filter((k) => !now.some((f) => f.from === k.from && f.to === k.to))
			.map((k) => foldEffect.of(k));
		if (effects.length > 0) view.dispatch({ effects });
		return result;
	};
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
		this.registerEditorExtension(normalCursorOffFoldEnd);
		const commands = window.CodeMirrorAdapter?.commands;
		const newline = commands?.newlineAndIndent;
		if (commands && newline) {
			commands.newlineAndIndent = wrapNewline(newline);
			this.register(() => {
				commands.newlineAndIndent = newline;
			});
		}

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

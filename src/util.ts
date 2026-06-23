import { arrayBufferToBase64, TFile } from "obsidian";
import { settings } from "./settings";

const context = "util";

function stringToColor(str: string): string {
	let hash = 0;
	for (let i = 0; i < str.length; i++) { hash = str.charCodeAt(i) + ((hash << 5) - hash); hash |= 0; }
	const hue = ((hash % 360) + 360) % 360;
	return `hsl(${hue}, 70%, 50%)`;
}

export function debugLog(context: string, message: object | string) {
	if (settings.debug) {
		const color = stringToColor(context);
		console.log(`[AIImageAnalyzer] %c[${context}]`, `color: ${color}; font-weight: bold;`, message);
	}
}

export function getTempBasePath(): string { return `${app.vault.configDir}/plugins/ai-image-analyzer/tmp`; }
export function getTempPath(file: TFile): string { return `${getTempBasePath()}/${file.path.replace(/\//g, "_")}`; }

export function isImageFile(file: TFile): boolean {
	const path = file.path;
	return path.endsWith(".png") || path.endsWith(".jpg") || path.endsWith(".jpeg") || path.endsWith(".webp") || path.endsWith(".svg");
}

/**
 * Extract all image references from a note Markdown content.
 * Returns array of objects with either { url } for http(s) URLs or { localPath } for local attachments.
 */
export function extractImageRefs(content: string): Array<{ url: string } | { localPath: string }> {
	const result: Array<{ url: string } | { localPath: string }> = [];
	const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
	let match;
	while ((match = regex.exec(content)) !== null) {
		const url = match[2];
		if (url.startsWith("http://") || url.startsWith("https://")) {
			result.push({ url });
		} else {
			// Local attachment: extract filename from path
			const localPath = url.replace(/^.*\//, "");
			result.push({ localPath });
		}
	}
	return result;
}

/**
 * HTML comment marker used to identify AI analysis callouts in notes.
 */
const CALOUT_MARKER = '<div style="display:none">ai-image-analyzer:';
const CALLOUT_TITLE = "图片OCR结果";

/**
 * Find all markdown files that reference a given image URL.
 */
export async function findAllNotesWithImageUrl(url: string): Promise<TFile[]> {
	const results: TFile[] = [];
	try {
		const allFiles = app.vault.getMarkdownFiles();
		for (const mdFile of allFiles) {
			try {
				const content = await app.vault.cachedRead(mdFile);
				if (content.includes(url)) {
					results.push(mdFile);
				}
			} catch { /* skip */ }
		}
	} catch { /* skip */ }
	return results;
}

/**
 * Find the first markdown file that references a given image URL.
 */
export async function findNoteWithImageUrl(url: string): Promise<TFile | null> {
	const notes = await findAllNotesWithImageUrl(url);
	return notes.length > 0 ? notes[0] : null;
}

/**
 * Build the full HTML comment marker for a URL.
 */
function makeCommentMarker(url: string): string {
	return `${CALOUT_MARKER} ${url}</div>`;
}

/**
 * Remove an AI analysis callout block from a note's content.
 * Returns the updated content, or null if not found.
 */
export async function removeAnalysisFromNote(noteFile: TFile, url: string): Promise<boolean> {
	try {
		const existingContent = await app.vault.cachedRead(noteFile);
		const block = findAnalysisBlock(existingContent, url);
		if (!block) return false;
		const newContent = existingContent.substring(0, block.start) + existingContent.substring(block.end);
		await app.vault.modify(noteFile, newContent);
		debugLog(context, `Removed analysis from ${noteFile.path}`);
		return true;
	} catch (e) {
		debugLog(context, `Failed to remove analysis from ${noteFile.path}: ${e instanceof Error ? e.message : String(e)}`);
		return false;
	}
}
/**
 * Sanitize AI analysis text for safe inclusion in a callout.
 * Fixes common Markdown syntax errors that would break callout rendering.
 */
function sanitizeAnalysisText(text: string): string {
	// 1. Remove incomplete code block markers (only opening, no closing)
	text = text.replace(/```\w*\n?/g, "");

	// 2. Fix unmatched backticks: remove lone backticks
	text = text.replace(/`(?![`])/g, "");

	// 3. Convert $^{**}$ to ** (bold LaTeX syntax)
	text = text.replace(/\$\^\{\*\*\}\$/g, "**");

	// 4. Remove redundant > prefixes (callout lines already get > from buildCallout)
	text = text.replace(/^\s*> /gm, "");

	// 5. Fix unmatched bold/italic markers
	text = text.replace(/(^|\s)\*\*$/gm, "");
	text = text.replace(/(^|\s)\*$/gm, "");

	// 6. Fix unmatched link syntax
	text = text.replace(/\[([^\]]*)\]\(\s*$/gm, "$1");

	// 7. Fix unmatched highlight syntax
	text = text.replace(/==([^\s].*)$/gm, "$1");

	// 8. Fix unmatched strikethrough syntax
	text = text.replace(/~([^ ].*)$/gm, "$1");

	// 9. Collapse multiple blank lines into one
	text = text.replace(/\n{3,}/g, "\n\n");

	// 10. Trim
	text = text.trim();
	return text;
}

function buildCallout(url: string, analysis: string): string {
	const sanitized = sanitizeAnalysisText(analysis);
	// Convert Markdown to HTML equivalents so they render properly inside callout with > prefix
	let htmlContent = sanitized;

	// 1. Handle tables: detect contiguous blocks of pipe-separated lines
	const tableBlockRegex = /(^\|.+\|?\n?)+/gm;
	htmlContent = htmlContent.replace(tableBlockRegex, (match) => {
		const rows = match.split("\n").filter(r => r.trim().startsWith("|"));
		if (rows.length < 2) return match; // Need at least header + separator or header + data
		let table = "<table><thead><tr>";
		const headerCells = rows[0].split("|").filter(c => c.trim()).map(c => c.trim());
		headerCells.forEach(cell => { table += "<th>" + cell + "</th>"; });
		table += "</tr></thead><tbody>";
		for (let i = 1; i < rows.length; i++) {
			const cells = rows[i].split("|").filter(c => c.trim()).map(c => c.trim());
			if (cells.every(c => /^[-]+$/.test(c))) continue; // Skip separator row
			table += "<tr>";
			cells.forEach(cell => { table += "<td>" + cell + "</td>"; });
			table += "</tr>";
		}
		table += "</tbody></table>";
		return table;
	});

	// 2. Handle horizontal rules: --- / *** / ___ → <hr>
	htmlContent = htmlContent.replace(/^(---+|\*\*\*+|___+)$/gm, "<hr>");

	// 3. Handle inline code: `code` → <code>code</code>
	htmlContent = htmlContent.replace(/`([^`]+)`/g, "<code>$1</code>");

	// 4. Handle footnotes: [text][1] → <sup>[1]</sup> text
	htmlContent = htmlContent.replace(/\[([^\]]+)\]\[(\d+)\]/g, '<sup>[$2]</sup> $1');

	// 5. Bold: **text** → <strong>text</strong>
	htmlContent = htmlContent.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

	// 6. Italic: *text* → <em>text</em>
	htmlContent = htmlContent.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");

	// 7. Links: [text](url) → <a href="url">text</a>
	htmlContent = htmlContent.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

	// 8. Highlight: ==text== → <mark>text</mark>
	htmlContent = htmlContent.replace(/==(.+?)==/g, "<mark>$1</mark>");

	// 9. Strikethrough: ~~text~~ → <del>text</del>
	htmlContent = htmlContent.replace(/~~(.+?)~~/g, "<del>$1</del>");

	// 10. Convert newlines to <br>
	htmlContent = htmlContent.replace(/\n/g, "<br>");

	return [
		"",
		`> [!info]- ${CALLOUT_TITLE}`,
		`> ${CALOUT_MARKER} ${url}</div>`,
		`> ${htmlContent}`,
		"",
	].join("\n");
}

/**
 * Find the position of an existing AI analysis block (callout + identifier) in note content.
 * Uses line-based matching for precision: finds the exact line containing the URL identifier,
 * then walks up to find the callout title and down to find the end of the callout line.
 * Handles URL-encoded variants of the marker.
 */
function findAnalysisBlock(content: string, url: string): { start: number; end: number } | null {
	// Try both raw and URL-encoded versions of the marker
	const candidates = [
		`${CALOUT_MARKER} ${url}</div>`,
		`${CALOUT_MARKER} ${encodeURIComponent(url)}</div>`,
	];

	for (const marker of candidates) {
		const lines = content.split("\n");
		let markerLineIdx = -1;
		let markerCol = -1;

		// Find the exact line containing this marker
		for (let i = 0; i < lines.length; i++) {
			const col = lines[i].indexOf(marker);
			if (col !== -1) {
				markerLineIdx = i;
				markerCol = col;
				break;
			}
		}

		if (markerLineIdx === -1) continue;

		// Walk backwards to find the callout title line "> [!info]- ..."
		let titleLineIdx = -1;
		for (let i = markerLineIdx - 1; i >= 0; i--) {
			if (lines[i].startsWith("> [!")) {
				titleLineIdx = i;
				break;
			}
		}

		if (titleLineIdx === -1) continue;

		// Calculate byte positions
		let blockStart = 0;
		for (let i = 0; i < titleLineIdx; i++) {
			blockStart += lines[i].length + 1; // +1 for \n
		}

		let blockEnd = 0;
		for (let i = 0; i <= markerLineIdx; i++) {
			blockEnd += lines[i].length + 1;
		}

		return { start: blockStart, end: blockEnd };
	}

	return null;
}

/**
 * Find the line number where a URL image reference appears in a note.
 * Returns the line index (0-based), or -1 if not found.
 */
function findImageUrlLine(content: string, url: string): number {
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].includes(`![`) && lines[i].includes(url)) {
			return i;
		}
	}
	return -1;
}

/**
 * Insert or replace an AI analysis callout in a note's content.
 * - If an existing block for this URL is found, replace it with the new content.
 * - Otherwise, insert the block right after the image reference line.
 */
export async function syncAnalysisInNote(noteFile: TFile, url: string, analysis: string): Promise<boolean> {
	try {
		const existingContent = await app.vault.cachedRead(noteFile);
		const calloutBlock = buildCallout(url, analysis);
		const block = findAnalysisBlock(existingContent, url);

		let newContent: string;
		if (block) {
			// Replace existing block
			newContent = existingContent.substring(0, block.start) + calloutBlock + existingContent.substring(block.end);
			debugLog(context, `Replaced existing analysis block in ${noteFile.path}`);
		} else {
			// Insert after the image reference
			const refLine = findImageUrlLine(existingContent, url);
			if (refLine === -1) {
				// Fallback: append to end of note with proper newline
				newContent = existingContent + "\n" + calloutBlock;
				debugLog(context, `Appended analysis to end of ${noteFile.path} (image ref not found)`);
			} else {
				const lines = existingContent.split("\n");
				// Insert after image reference with a blank line separator
				lines.splice(refLine + 1, 0, ...calloutBlock.split("\n").filter(l => l.trim() !== ""));
				newContent = lines.join("\n");
				debugLog(context, `Inserted analysis after image ref in ${noteFile.path}`);
			}
		}

		await app.vault.modify(noteFile, newContent);
		return true;
	} catch (e) {
		debugLog(context, `Failed to sync analysis in ${noteFile.path}: ${e instanceof Error ? e.message : String(e)}`);
		return false;
	}
}
export async function extractImageUrlForFile(file: TFile): Promise<string | null> {
	const allFiles = app.vault.getMarkdownFiles();
	const fileName = file.path;
	for (const mdFile of allFiles) {
		try {
			const content = await app.vault.cachedRead(mdFile);
			const refs = extractImageRefs(content);
			for (const ref of refs) {
				if ("url" in ref) {
					if (ref.url === fileName || ref.url.includes(fileName) || fileName.endsWith(ref.url.replace(/^.*\//, ""))) {
						return ref.url;
					}
				}
			}
		} catch { /* skip */ }
	}
	return null;
}

export async function readFile(file: TFile): Promise<string> {
	if (file.path.endsWith(".svg")) {
		debugLog(context, "Converting SVG to PNG");
		try {
			const svgData: string = await app.vault.adapter.read(file.path);
			return await new Promise<string>((resolve, reject) => {
				const canvas = document.createElement("canvas");
				canvas.width = 1000; canvas.height = 1000;
				const ctx = canvas.getContext("2d");
				if (!ctx) { reject(new Error("Could not get canvas context")); return; }
				const image = new Image();
				image.onload = () => { try { ctx.drawImage(image, 0, 0, 1000, 1000); resolve(canvas.toDataURL("image/png").split(",")[1]); } catch (err) { reject(err); } };
				image.onerror = (error) => { console.error("Error loading SVG image:", error); reject(error); };
				image.src = `data:image/svg+xml;base64,${btoa(svgData)}`;
			});
		} catch (error) { console.error("Error converting SVG to PNG:", error); throw error; }
	} else {
		return arrayBufferToBase64(await app.vault.readBinary(file));
	}
}

/**
 * Extract image URL from the markdown content at a given cursor position.
 * Searches the current line first, then falls back to the entire note.
 */
export function extractImageUrlAtCursor(cursorPos: { ch: number; line: number } | undefined): string | null {
	if (!cursorPos) return null;
	try {
		const editor = app.workspace.activeEditor?.editor;
		if (!editor) return null;

		// First: try to find an image URL on the current line
		const line = editor.getLine(cursorPos.line);
		if (line) {
			const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
			let match;
			while ((match = regex.exec(line)) !== null) {
				const start = match.index;
				const end = start + match[0].length;
				if (cursorPos.ch >= start && cursorPos.ch <= end) {
					const url = match[2];
					if (url.startsWith("http://") || url.startsWith("https://")) {
						return url;
					}
				}
			}
		}

		// Fallback: search the entire note for the closest image URL to the cursor position
		const allContent = editor.getValue();
		const allLines = allContent.split("\n");
		let closestUrl: string | null = null;
		let closestDist = Infinity;
		const imageRegex = /!\[[^\]]*\]\((https?:\/\/[^)]+)\)/g;
		let imgMatch;
		while ((imgMatch = imageRegex.exec(allContent)) !== null) {
			const urlStart = imgMatch.index;
			const urlEnd = urlStart + imgMatch[0].length;
			const lineNum = allContent.substring(0, urlStart).split("\n").length - 1;
			const colNum = urlStart - allContent.split("\n")[lineNum].indexOf(imgMatch[0]);
			const dist = Math.sqrt(Math.pow(lineNum - cursorPos.line, 2) + Math.pow(colNum - cursorPos.ch, 2));
			if (dist < closestDist) {
				closestDist = dist;
				closestUrl = imgMatch[1];
			}
		}
		return closestUrl;
	} catch {
		return null;
	}
}

export function htmlDescription(innerHTML: string): DocumentFragment {
	const desc = new DocumentFragment();
	desc.createSpan({}, (span) => { span.innerHTML = innerHTML; });
	return desc;
}

import { createHash } from "crypto";
import { TFile } from "obsidian";
import { libVersion } from "./globals";
import { AnalyzedText } from "./types";
import { debugLog } from "./util";
import { findAllNotesWithImageUrl, removeAnalysisFromNote } from "./util";

const context = "cache";

export function getCacheBasePath(): string {
	return `${app.vault.configDir}/plugins/ai-image-analyzer/cache`;
}

function getCachePath(file: TFile): string {
	const hash = createHash("md5").update(file.path).digest("hex");
	return `${getCacheBasePath()}/${hash}.json`;
}

function getCachePathByUrl(url: string): string {
	const hash = createHash("md5").update(url).digest("hex");
	return `${getCacheBasePath()}/url_${hash}.json`;
}

export async function isInCache(file: TFile): Promise<boolean> {
	return await app.vault.adapter.exists(getCachePath(file));
}

export async function isInCacheByUrl(url: string): Promise<boolean> {
	return await app.vault.adapter.exists(getCachePathByUrl(url));
}

export async function writeCache(file: TFile, text: string): Promise<void> {
	if (text.length === 0) return;
	const path = getCachePath(file);
	if (!(await app.vault.adapter.exists(getCacheBasePath()))) await app.vault.adapter.mkdir(getCacheBasePath());
	const data: AnalyzedText = { path: file.path, text, libVersion };
	debugLog(context, `Writing cache entry for ${file.path}`);
	await app.vault.adapter.write(path, JSON.stringify(data));
}

export async function writeCacheByUrl(url: string, text: string): Promise<void> {
	if (text.length === 0) return;
	const path = getCachePathByUrl(url);
	if (!(await app.vault.adapter.exists(getCacheBasePath()))) await app.vault.adapter.mkdir(getCacheBasePath());
	const data: AnalyzedText = { path: url, text, libVersion };
	debugLog(context, `Writing cache entry for URL ${url}`);
	await app.vault.adapter.write(path, JSON.stringify(data));
}

export async function readCache(file: TFile): Promise<AnalyzedText | null> {
	try {
		if (await isInCache(file)) {
			const raw = await app.vault.adapter.read(getCachePath(file));
			const text = JSON.parse(raw) as AnalyzedText;
			if (text.text.length === 0) { await removeFromCache(file); return null; }
			debugLog(context, `Read cache entry for ${file.path}`);
			return text;
		}
	} catch (e) { console.error(e); }
	return null;
}

export async function readCacheByUrl(url: string): Promise<AnalyzedText | null> {
	try {
		const path = getCachePathByUrl(url);
		if (await app.vault.adapter.exists(path)) {
			const raw = await app.vault.adapter.read(path);
			const text = JSON.parse(raw) as AnalyzedText;
			if (text.text.length === 0) { await removeFromCacheByUrl(url); return null; }
			debugLog(context, `Read URL cache entry for ${url}`);
			return text;
		}
	} catch (e) { console.error(e); }
	return null;
}

export async function removeFromCache(file: TFile): Promise<void> {
	const path = getCachePath(file);
	if (await isInCache(file)) { debugLog(context, `Removing cache entry for ${file.path}`); return await app.vault.adapter.remove(path); }
}

export async function removeFromCacheByUrl(url: string): Promise<void> {
	const path = getCachePathByUrl(url);
	if (await app.vault.adapter.exists(path)) {
		debugLog(context, `Removing URL cache entry for ${url}`);
		await app.vault.adapter.remove(path);
		// Also remove callouts from ALL notes that reference this URL
		const notes = await findAllNotesWithImageUrl(url);
		for (const noteFile of notes) {
			await removeAnalysisFromNote(noteFile, url);
		}
	}
}

export async function clearCache(): Promise<void> {
	const path = getCacheBasePath();
	if (await app.vault.adapter.exists(path)) {
		debugLog(context, `Clearing cache`);
		// Collect all URL cache entries to remove their callouts from notes
		const files = await app.vault.adapter.list(path);
		for (const entry of files.entries ?? []) {
			if (entry.path.startsWith("url_") && entry.path.endsWith(".json")) {
				const raw = await app.vault.adapter.read(entry.path);
				try {
					const data = JSON.parse(raw) as AnalyzedText;
					const url = data.path;
					if (url && url.startsWith("http")) {
						const notes = await findAllNotesWithImageUrl(url);
						for (const noteFile of notes) {
							await removeAnalysisFromNote(noteFile, url);
						}
					}
				} catch { /* skip invalid cache files */ }
			}
		}
		await app.vault.adapter.rmdir(path, true);
	}
}

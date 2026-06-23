import { Notice, TFile, Vault } from "obsidian";
import { debugLog, extractImageRefs, findNoteWithImageUrl, syncAnalysisInNote } from "./util";
import { AgnesProvider } from "./ai-adapter/providers/agnesProvider";
import { OpenAICompatibleProvider } from "./ai-adapter/providers/openaiCompatibleProvider";
import { provider } from "./ai-adapter/globals";
import { writeCacheByUrl, isInCacheByUrl } from "./cache";
import { settings } from "./settings";

const context = "autoAnalyzer";

let currentVault: Vault | null = null;

export function setAutoAnalyzeVault(vault: Vault): void {
	currentVault = vault;
}

export async function autoAnalyzeVault(): Promise<number> {
	if (!currentVault) {
		debugLog(context, "Vault not set for auto analyze");
		return 0;
	}
	const providerType = settings.aiAdapterSettings.provider;
	if (providerType !== "agnes" && providerType !== "openai-compatible") {
		new Notice("Auto analyze is only available for Agnes and OpenAI Compatible providers");
		return 0;
	}

	debugLog(context, "Starting vault scan for image URLs");
	new Notice("Scanning vault for images...");

	const allFiles = currentVault!.getFiles();
	const markdownFiles = allFiles.filter((f: TFile) => f.extension === "md");
	debugLog(context, `Found ${markdownFiles.length} markdown files`);

	let analyzedCount = 0;
	let skippedCount = 0;
	let errorCount = 0;

	for (const mdFile of markdownFiles) {
		try {
			const content = await currentVault!.cachedRead(mdFile);
			const imageRefs = extractImageRefs(content);
			for (const ref of imageRefs) {
				if ("url" in ref) {
					// Remote URL image
					if (await isInCacheByUrl(ref.url)) { skippedCount++; continue; }
					debugLog(context, `Analyzing URL: ${ref.url}`);
					try {
						let response: string;
						if (providerType === "agnes") {
							response = await (provider as AgnesProvider).queryWithImageUrlHandling(settings.prompt, ref.url);
						} else {
							response = await (provider as OpenAICompatibleProvider).queryWithImageUrlHandling(settings.prompt, ref.url);
						}
						if (response && !response.startsWith("[AI-ERROR]")) {
							await writeCacheByUrl(ref.url, response);
							// Sync callout in the note
							const noteFile = await findNoteWithImageUrl(ref.url);
							if (noteFile) {
								await syncAnalysisInNote(noteFile, ref.url, response);
							}
							analyzedCount++;
						} else {
							errorCount++;
							debugLog(context, `Error for ${ref.url}: ${response}`);
						}
					} catch (e) {
						errorCount++;
						debugLog(context, `Failed to analyze ${ref.url}: ${e instanceof Error ? e.message : String(e)}`);
					}
				} else {
					// Local attachment image
					// These are handled by the file-menu handler via analyzeImage
					// Skip here to avoid double-processing
					skippedCount++;
				}
			}
		} catch (e) {
			debugLog(context, `Failed to read ${mdFile.path}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	debugLog(context, `Scan complete: ${analyzedCount} analyzed, ${skippedCount} skipped, ${errorCount} errors`);
	new Notice(`Scan complete: ${analyzedCount} analyzed, ${skippedCount} skipped, ${errorCount} errors`);
	return analyzedCount;
}

let scanInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoScan(): void {
	stopAutoScan();
	const intervalMinutes = settings.autoAnalyzeInterval;
	if (intervalMinutes <= 0) { debugLog(context, "Auto scan disabled"); return; }
	const intervalMs = intervalMinutes * 60 * 1000;
	debugLog(context, `Starting auto scan every ${intervalMinutes} minutes`);
	scanInterval = setInterval(async () => {
		debugLog(context, "Running scheduled auto scan");
		try { await autoAnalyzeVault(); }
		catch (e) { debugLog(context, `Auto scan error: ${e instanceof Error ? e.message : String(e)}`); }
	}, intervalMs);
}

export function stopAutoScan(): void {
	if (scanInterval !== null) { clearInterval(scanInterval); scanInterval = null; debugLog(context, "Stopped auto scan"); }
}

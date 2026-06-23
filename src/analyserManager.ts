import { Notice, TFile } from "obsidian";
import { isInCache, readCache, writeCache } from "./cache";
import { debugLog, isImageFile, readFile, extractImageUrlForFile } from "./util";
import { settings } from "./settings";
import { imagesProcessQueue, runWithTimeout } from "./globals";
import { queryWithImage } from "./ai-adapter/api";
import { provider } from "./ai-adapter/globals";
import { OllamaProvider } from "./ai-adapter/providers/ollamaProvider";
import { GeminiProvider } from "./ai-adapter/providers/geminiProvider";
import { AgnesProvider } from "./ai-adapter/providers/agnesProvider";
import { OpenAICompatibleProvider } from "./ai-adapter/providers/openaiCompatibleProvider";
import { writeCacheByUrl, isInCacheByUrl, readCacheByUrl } from "./cache";

const context = "analyserManager";
const retriedImages = new Set<string>();
const ANALYZE_TIMEOUT_MS = 120000;

export async function analyzeImage(file: TFile): Promise<string> {
	try { return (await imagesProcessQueue.add(() => analyzeImageTask(file))) ?? ""; }
	catch (e) { const errMsg = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e); debugLog(context, errMsg); return ""; }
}

async function analyzeImageTask(file: TFile): Promise<string> {
	const key = file.path;
	try { return await runWithTimeout(analyzeImageHandling(file), ANALYZE_TIMEOUT_MS); }
	catch (e) {
		const errMsg = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
		debugLog(context, `analyzeImageHandling failed for ${key}:`);
		debugLog(context, errMsg);
		if (!retriedImages.has(key)) {
			retriedImages.add(key);
			if (provider instanceof OllamaProvider) OllamaProvider.refreshInstance();
			if (provider instanceof GeminiProvider) GeminiProvider.restartSession();
			debugLog(context, `Retrying image once: ${key}`);
			try { return await runWithTimeout(analyzeImageHandling(file), ANALYZE_TIMEOUT_MS); }
			catch (e2) {
				const errMsg2 = e2 instanceof Error ? e2.message : typeof e2 === "string" ? e2 : JSON.stringify(e2);
				debugLog(context, `Retry also failed for ${key}:`);
				debugLog(context, errMsg2);
				throw e2;
			}
		}
		throw e;
	}
}

async function analyzeImageHandling(file: TFile): Promise<string> {
	debugLog(context, `Analyzing image ${file.name}`);
	if (!isImageFile(file)) return Promise.reject("File is not an image");

	const providerType = settings.aiAdapterSettings.provider;

	// Agnes: URL-only
	if (providerType === "agnes") return analyzeWithUrlProvider(file, "agnes");

	// OpenAI Compatible: URL first, fallback to base64
	if (providerType === "openai-compatible") {
		const openaiSettings = settings.aiAdapterSettings.openaiCompatibleSettings;
		if (openaiSettings && openaiSettings.useUrl) {
			const result = await analyzeWithUrlProvider(file, "openai-compatible");
			if (result && !result.startsWith("[AI-ERROR]")) return result;
		}
		if (openaiSettings && openaiSettings.useBase64) return analyzeWithBase64(file);
		return Promise.reject("OpenAI Compatible: no input method configured");
	}

	// Ollama / Gemini: base64 (original behavior)
	return analyzeWithBase64(file);
}

async function analyzeWithUrlProvider(file: TFile, providerType: "agnes" | "openai-compatible"): Promise<string> {
	debugLog(context, `Using URL-based analysis for ${providerType}`);
	const imageUrl = await extractImageUrlForFile(file);
	if (!imageUrl) return Promise.reject(`No image URL found for ${file.path}. Make sure the image is referenced as ![alt](https://...) in a note.`);
	debugLog(context, `Found image URL: ${imageUrl}`);

	const cached = await readCacheByUrl(imageUrl);
	if (cached && cached.text) { debugLog(context, "URL cache hit"); return Promise.resolve(cached.text); }

	const prompt = settings.prompt;
	let response: string;
	try {
		if (providerType === "agnes") {
			response = await (provider as AgnesProvider).queryWithImageUrlHandling(prompt, imageUrl);
		} else {
			response = await (provider as OpenAICompatibleProvider).queryWithImageUrlHandling(prompt, imageUrl);
		}
	} catch (e) {
		const errMsg = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
		debugLog(context, `URL analysis failed: ${errMsg}`);
		return Promise.reject(`Failed to analyze image: ${errMsg}`);
	}
	if (!response || response.startsWith("[AI-ERROR]")) return Promise.reject(response || "Failed to analyze image");
	await writeCacheByUrl(imageUrl, response);
	debugLog(context, `Image analyzed via URL ${file.name}`);
	return Promise.resolve(response);
}

async function analyzeWithBase64(file: TFile): Promise<string> {
	debugLog(context, `Using base64 analysis for ${file.name}`);
	if (await isInCache(file)) {
		const text = await readCache(file);
		if (text && text.text !== "") { debugLog(context, "Reading from cache"); return Promise.resolve(text.text); }
	}
	try {
		const data: string = await readFile(file);
		const response = await queryWithImage(settings.prompt, data);
		if (!response) return Promise.reject("Failed to analyze image");
		await writeCache(file, response);
		debugLog(context, `Image analyzed ${file.name}`);
		return Promise.resolve(response);
	} catch (e) {
		const errMsg = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
		debugLog(context, errMsg);
		return Promise.reject("Failed to analyze image");
	}
}

export async function analyzeImageWithNotice(file: TFile): Promise<string> {
	try {
		const notice = new Notice("Analyzing image", 0);
		const text = await analyzeImage(file);
		notice.hide();
		if (text == "") { new Notice("Failed to analyze image"); return ""; }
		new Notice("Image analyzed");
		return text;
	} catch (e) {
		const errMsg = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
		debugLog(context, errMsg);
		new Notice("Failed to analyze image");
		new Notice(errMsg);
		return "";
	}
}

export async function analyzeToClipboard(file: TFile) {
	try {
		const text = await analyzeImageWithNotice(file);
		if (text == "") return;
		await activeWindow.navigator.clipboard.writeText(text);
		new Notice("Text copied to clipboard");
	} catch (e) {
		const errMsg = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
		debugLog(context, errMsg);
	}
}

import { MenuItem, Notice, Plugin, TFile } from "obsidian";
import { isInCache, removeFromCache } from "./cache";
import { analyzeImage, analyzeImageWithNotice, analyzeToClipboard } from "./analyserManager";
import { debugLog, isImageFile, extractImageUrlAtCursor, findNoteWithImageUrl, syncAnalysisInNote, extractImageRefs, findAllNotesWithImageUrl } from "./util";
import { AIImageAnalyzerSettingsTab, loadSettings, settings } from "./settings";
import { imagesProcessQueue } from "./globals";
import { provider, setProvider, unsubscribeFunctionSetting } from "./ai-adapter/globals";
import { initProvider } from "./ai-adapter/util";
import { autoAnalyzeVault, setAutoAnalyzeVault, startAutoScan, stopAutoScan } from "./autoAnalyzer";
import { writeCacheByUrl, readCacheByUrl, removeFromCacheByUrl } from "./cache";
import { AgnesProvider } from "./ai-adapter/providers/agnesProvider";
import { OpenAICompatibleProvider } from "./ai-adapter/providers/openaiCompatibleProvider";

const context = "main";

export type AIImageAnalyzerAPI = {
	analyzeImage: (file: TFile) => Promise<string>;
	canBeAnalyzed: (file: TFile) => boolean;
	isInCache: (file: TFile) => Promise<boolean>;
};

export default class AIImageAnalyzerPlugin extends Plugin {
	public api: AIImageAnalyzerAPI = {
		analyzeImage: analyzeImage,
		canBeAnalyzed: isImageFile,
		isInCache: isInCache,
	};

	public async autoAnalyzeVault(): Promise<number> {
		return await autoAnalyzeVault();
	}

	/**
	 * Analyze all images (URL + local) in a note file.
	 */
	async analyzeNoteImages(file: TFile): Promise<void> {
		debugLog(context, `Analyzing all images in ${file.path}`);
		const notice = new Notice("Analyzing images in note...", 0);

		try {
			const content = await app.vault.cachedRead(file);
			const imageRefs = extractImageRefs(content);

			if (imageRefs.length === 0) {
				notice.hide();
				new Notice("No images found in this note");
				return;
			}

			const providerType = settings.aiAdapterSettings.provider;
			let analyzed = 0;
			let skipped = 0;
			let errors = 0;

			for (const ref of imageRefs) {
				if ("url" in ref) {
					const cached = await readCacheByUrl(ref.url);
					if (cached && cached.text) {
						skipped++;
						continue;
					}
					let response: string;
					try {
						if (providerType === "agnes") {
							response = await (provider as AgnesProvider).queryWithImageUrlHandling(settings.prompt, ref.url);
						} else {
							response = await (provider as OpenAICompatibleProvider).queryWithImageUrlHandling(settings.prompt, ref.url);
						}
					} catch (e) {
						errors++;
						continue;
					}
					if (!response || response.startsWith("[AI-ERROR]")) {
						errors++;
						continue;
					}
					await writeCacheByUrl(ref.url, response);
					const noteFile = await findNoteWithImageUrl(ref.url);
					if (noteFile) {
						await syncAnalysisInNote(noteFile, ref.url, response);
					}
					analyzed++;
				} else {
					const localPath = (ref as any).localPath;
					const localFile = app.vault.getAbstractFileByPath(localPath) as TFile;
					if (!localFile || !isImageFile(localFile)) {
						skipped++;
						continue;
					}
					if (await isInCache(localFile)) {
						skipped++;
						continue;
					}
					try {
						const response = await analyzeImage(localFile);
						if (response && !response.startsWith("[AI-ERROR]")) {
							analyzed++;
						} else {
							errors++;
						}
					} catch {
						errors++;
					}
				}
			}

			notice.hide();
			new Notice(`Done: ${analyzed} analyzed, ${skipped} cached, ${errors} errors`);
		} catch (e) {
			notice.hide();
			const errMsg = e instanceof Error ? e.message : String(e);
			debugLog(context, `analyzeNoteImages failed: ${errMsg}`);
			new Notice("Failed to analyze images in note");
		}
	}

	/**
	 * Clear cache for all images (URL + local) referenced in a note.
	 */
	async clearNoteImagesCache(file: TFile): Promise<void> {
		debugLog(context, `Clearing cache for all images in ${file.path}`);
		try {
			const content = await app.vault.cachedRead(file);
			const imageRefs = extractImageRefs(content);
			let cleared = 0;
			for (const ref of imageRefs) {
				if ("url" in ref) {
					await removeFromCacheByUrl(ref.url);
					cleared++;
				} else {
					const localPath = (ref as any).localPath;
					const localFile = app.vault.getAbstractFileByPath(localPath) as TFile;
					if (localFile && isImageFile(localFile)) {
						await removeFromCache(localFile);
						cleared++;
					}
				}
			}
			new Notice(`Cleared ${cleared} image cache(s) from ${file.path}`);
		} catch (e) {
			const errMsg = e instanceof Error ? e.message : String(e);
			debugLog(context, `clearNoteImagesCache failed: ${errMsg}`);
			new Notice("Failed to clear image cache");
		}
	}

	async analyzeImageUrl(url: string): Promise<void> {
		debugLog(context, `Analyzing image URL: ${url}`);
		const notice = new Notice("Analyzing image URL", 0);

		let response: string;

		const cached = await readCacheByUrl(url);
		if (cached && cached.text) {
			response = cached.text;
			debugLog(context, "URL cache hit");
		} else {
			const providerType = settings.aiAdapterSettings.provider;
			try {
				if (providerType === "agnes") {
					response = await (provider as AgnesProvider).queryWithImageUrlHandling(settings.prompt, url);
				} else if (providerType === "openai-compatible") {
					response = await (provider as OpenAICompatibleProvider).queryWithImageUrlHandling(settings.prompt, url);
				} else {
					notice.hide();
					new Notice("URL analysis only available for Agnes and OpenAI Compatible providers");
					return;
				}
			} catch (e) {
				notice.hide();
				const errMsg = e instanceof Error ? e.message : String(e);
				debugLog(context, `URL analysis failed: ${errMsg}`);
				new Notice("Failed to analyze image URL");
				return;
			}

			notice.hide();

			if (!response || response.startsWith("[AI-ERROR]")) {
				new Notice(response?.replace("[AI-ERROR]", "") || "Failed to analyze image URL");
				return;
			}

			await writeCacheByUrl(url, response);
		}

		const noteFile = await findNoteWithImageUrl(url);
		if (noteFile) {
			await syncAnalysisInNote(noteFile, url, response);
		}

		if (cached) {
			new Notice("Analysis result synced from cache");
		} else {
			new Notice("Image URL analyzed");
		}
	}

	async onload() {
		debugLog(context, "loading ai image analyzer plugin");
		await loadSettings(this);
		setAutoAnalyzeVault(this.app.vault);
		setProvider(initProvider());

		if (settings.autoAnalyzeEnabled && settings.autoAnalyzeInterval > 0) {
			startAutoScan();
		}

		this.addCommand({
			id: "analyze-image-to-clipboard",
			name: "Analyze image to clipboard",
			checkCallback: (checking: boolean) => {
				const file = getActiveFile();
				if (file != null && isImageFile(file)) {
					if (!checking) analyzeToClipboard(file);
					return true;
				}
				return false;
			},
		});

		this.addCommand({
			id: "analyze-image",
			name: "Analyze image",
			checkCallback: (checking: boolean) => {
				const file = getActiveFile();
				if (file != null && isImageFile(file)) {
					if (!checking) analyzeImageWithNotice(file);
					return true;
				}
				return false;
			},
		});

		this.addCommand({
			id: "clear-cache-of-active-image",
			name: "Clear cache of active image",
			checkCallback: (checking: boolean) => {
				const file = getActiveFile();
				if (file != null && isImageFile(file)) {
					if (!checking) { removeFromCache(file); new Notice("Cache cleared"); }
					return true;
				}
				return false;
			},
		});

		this.addCommand({
			id: "auto-analyze-all-images",
			name: "Auto analyze all image URLs in vault",
			callback: async () => {
				const providerType = settings.aiAdapterSettings.provider;
				if (providerType !== "agnes" && providerType !== "openai-compatible") {
					new Notice("Auto analyze is only available for Agnes and OpenAI Compatible providers");
					return;
				}
				await autoAnalyzeVault();
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file, _source) => {
				if (file instanceof TFile && isImageFile(file)) {
					menu.addItem((item: MenuItem) => {
						item.setTitle("AI Analyze Image");
						const submenu = item.setSubmenu();
						submenu.addItem((item) => item
							.setTitle("Analyze Image to Clipboard")
							.setIcon("clipboard")
							.onClick(() => analyzeToClipboard(file)));
						submenu.addItem((item) => item
							.setTitle("Analyze Image")
							.setIcon("search")
							.onClick(async () => {
								await removeFromCache(file);
								await analyzeImageWithNotice(file);
							}));
						submenu.addItem((item) => item
							.setTitle("Clear Cache")
							.setIcon("trash")
							.onClick(async () => {
								await removeFromCache(file);
								new Notice("Cache cleared");
							}));
					});
				}
			}),
		);

		// File menu: when right-clicking a .md file in the file explorer
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file, _source) => {
				if (file instanceof TFile && file.extension === "md") {
					const providerType = settings.aiAdapterSettings.provider;
					if (providerType === "agnes" || providerType === "openai-compatible") {
						menu.addItem((item: MenuItem) => {
							item.setTitle("AI Analyze Image");
							const submenu = item.setSubmenu();
							submenu.addItem((item) => item
								.setTitle("Analyze All Images in this Note")
								.setIcon("search")
								.onClick(() => this.analyzeNoteImages(file)));
							submenu.addItem((item) => item
								.setTitle("Clear Cache in this Note")
								.setIcon("trash")
								.onClick(() => this.clearNoteImagesCache(file)));
						});
					}
				}
			}),
		);

		// Editor menu: when right-clicking on a URL image in the editor
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, _editor, info) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return;
				const cursorPos = ("cursor" in info && info.cursor) ? (info as any).cursor?.pos : undefined;
				if (!cursorPos) return;
				const url = extractImageUrlAtCursor(cursorPos);
				if (!url) return;
				menu.addItem((item: MenuItem) => {
					item.setTitle("AI Analyze Image");
					const submenu = item.setSubmenu();
					submenu.addItem((item) => item
						.setTitle("Analyze Image to Clipboard")
						.setIcon("clipboard")
						.onClick(async () => {
							const notice = new Notice("Analyzing...", 0);
							try {
								const cached = await readCacheByUrl(url);
								let response: string;
								if (cached && cached.text) {
									response = cached.text;
								} else {
									const providerType = settings.aiAdapterSettings.provider;
									if (providerType === "agnes") {
										response = await (provider as AgnesProvider).queryWithImageUrlHandling(settings.prompt, url);
									} else if (providerType === "openai-compatible") {
										response = await (provider as OpenAICompatibleProvider).queryWithImageUrlHandling(settings.prompt, url);
									} else {
										notice.hide();
										new Notice("URL analysis only available for Agnes and OpenAI Compatible providers");
										return;
									}
									if (response && !response.startsWith("[AI-ERROR]")) {
										await writeCacheByUrl(url, response);
									}
								}
								notice.hide();
								if (response && !response.startsWith("[AI-ERROR]")) {
									await activeWindow.navigator.clipboard.writeText(response);
									new Notice("Copied to clipboard");
								} else {
									new Notice("Failed to analyze image");
								}
							} catch (e) {
								notice.hide();
								new Notice("Failed to analyze image");
							}
						}));
					submenu.addItem((item) => item
						.setTitle("Analyze Image")
						.setIcon("search")
						.onClick(() => this.analyzeImageUrl(url)));
					submenu.addItem((item) => item
						.setTitle("Clear Cache")
						.setIcon("trash")
						.onClick(async () => {
							await removeFromCacheByUrl(url);
							new Notice("Cache cleared");
						}));
				});
			}),
		);

		this.addSettingTab(new AIImageAnalyzerSettingsTab(this.app, this));

		// Register with Notebook Navigator's file menu extension API
		const nnPlugin = (this.app as any).plugins?.getPlugin("notebook-navigator");
		if (nnPlugin && typeof (nnPlugin as any).registerFileMenu === "function") {
			(nnPlugin as any).registerFileMenu((context: any) => {
				if (context.file && context.file.extension === "md") {
					const providerType = settings.aiAdapterSettings.provider;
					if (providerType === "agnes" || providerType === "openai-compatible") {
						context.menu.addItem((item: MenuItem) => {
							item.setTitle("AI Analyze Image");
							const submenu = item.setSubmenu();
							submenu.addItem((item) => item
								.setTitle("Analyze All Images in this Note")
								.setIcon("search")
								.onClick(() => this.analyzeNoteImages(context.file)));
							submenu.addItem((item) => item
								.setTitle("Clear Cache in this Note")
								.setIcon("trash")
								.onClick(() => this.clearNoteImagesCache(context.file)));
						});
					}
				}
			});
		}
	}

	onunload() {
		imagesProcessQueue.clear();
		provider.shutdown();
		stopAutoScan();
		if (unsubscribeFunctionSetting) unsubscribeFunctionSetting();
		debugLog(context, "unloading ai image analyzer plugin");
	}
}

function getActiveFile(): TFile | null {
	return (
		//@ts-ignore
		this.app.workspace.activeEditor?.file ??
		//@ts-ignore
		this.app.workspace.getActiveFile()
	);
}

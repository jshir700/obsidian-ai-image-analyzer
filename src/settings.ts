import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { clearCache } from "./cache";
import AIImageAnalyzerPlugin from "./main";
import { debugLog } from "./util";
import { AIAdapterPluginSettings, generateSettings } from "./ai-adapter/settings";
import { DEFAULT_SETTINGS as AI_ADAPTER_DEFAULT_SETTINGS } from "./ai-adapter/settings";
import { setUnsubscribeFunctionSetting, subscribeModelsChange } from "./ai-adapter/globals";

const context = "settings";

interface AIImageAnalyzerPluginSettings {
	debug: boolean;
	prompt: string;
	autoClearCache: boolean;
	aiAdapterSettings: AIAdapterPluginSettings;
	autoAnalyzeEnabled: boolean;
	autoAnalyzeInterval: number;
}

const DEFAULT_SETTINGS: AIImageAnalyzerPluginSettings = {
	debug: false,
	prompt: "Analyze the image and output in Markdown format. Combine the following three parts separated by a single blank line: first, extract all visible text exactly as shown, preserving the original language without translation or omission; second, describe the main content, key elements, colors, and objects in Simplified Chinese; third, provide a short list of comma-separated keywords in Simplified Chinese for search. Before outputting, carefully check and fix all Markdown syntax errors.",
	autoClearCache: true,
	aiAdapterSettings: AI_ADAPTER_DEFAULT_SETTINGS,
	autoAnalyzeEnabled: false,
	autoAnalyzeInterval: 0,
};

export let settings: AIImageAnalyzerPluginSettings = Object.assign({}, DEFAULT_SETTINGS);

export async function loadSettings(plugin: AIImageAnalyzerPlugin) {
	settings = Object.assign({}, DEFAULT_SETTINGS, await plugin.loadData());
}

export async function saveSettings(plugin: AIImageAnalyzerPlugin) {
	await plugin.saveData(settings);
}

export class AIImageAnalyzerSettingsTab extends PluginSettingTab {
	plugin: AIImageAnalyzerPlugin;
	constructor(app: App, plugin: AIImageAnalyzerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		setUnsubscribeFunctionSetting(subscribeModelsChange(() => {
			debugLog(context, "Models changed, updating settings tab");
			this.display();
		}));
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Clear cache")
			.setDesc("Clear the cache, reanalyzing images could take a while")
			.addButton((button) => button.setButtonText("Clear cache").onClick(async () => {
				await clearCache(); new Notice("Cache cleared");
			}));

		new Setting(containerEl)
			.setName("Debug mode")
			.setDesc("Enable debug mode to see logs in the console")
			.addToggle((toggle) => toggle.setValue(settings.debug).onChange(async (value) => {
				settings.debug = value; await saveSettings(this.plugin);
			}));

		new Setting(containerEl).setName("AI configuration").setHeading();
		generateSettings(containerEl, this.plugin);

		new Setting(containerEl).setName("Auto Analyze").setHeading();

		new Setting(containerEl)
			.setName("Auto analyze enabled")
			.setDesc("Automatically scan notes for image URLs and analyze them")
			.addToggle((toggle) => toggle.setValue(settings.autoAnalyzeEnabled).onChange(async (value) => {
				settings.autoAnalyzeEnabled = value; await saveSettings(this.plugin);
			}));

		new Setting(containerEl)
			.setName("Scan interval (minutes)")
			.setDesc("How often to scan for new/changed images. 0 = manual only")
			.addText((text) =>
				text.setPlaceholder("0").setValue(String(settings.autoAnalyzeInterval))
					.onChange(async (value) => {
						settings.autoAnalyzeInterval = isNaN(parseInt(value, 10)) ? 0 : parseInt(value, 10);
						await saveSettings(this.plugin);
					}),
			);

		new Setting(containerEl)
			.setName("Manual scan now")
			.setDesc("Trigger an immediate scan of all notes for image URLs")
			.addButton((button) =>
				button.setButtonText("Scan now").onClick(async () => {
					button.setButtonText("Scanning...");
					button.buttonEl.disabled = true;
					try {
						await this.plugin.autoAnalyzeVault();
						new Notice("Scan complete");
					} catch (e) {
						new Notice("Scan failed: " + (e instanceof Error ? e.message : String(e)));
					} finally {
						button.setButtonText("Scan now");
						button.buttonEl.disabled = false;
					}
				}),
			);

		new Setting(containerEl).setName("Advanced").setHeading();

		new Setting(containerEl)
			.setName("Prompt")
			.setDesc("Set the prompt to use alongside the image")
			.addTextArea((text) => {
				text.inputEl.rows = 5; text.inputEl.cols = 50;
				return text.setPlaceholder("Enter the prompt").setValue(settings.prompt)
					.onChange(async (value) => {
						if (value.length === 0) value = DEFAULT_SETTINGS.prompt;
						settings.prompt = value;
						await saveSettings(this.plugin);
						if (settings.autoClearCache) await clearCache();
					});
			})
			.addButton((button) =>
				button.setButtonText("Reset to default")
					.setTooltip("Restore the default prompt")
					.onClick(async () => {
						settings.prompt = DEFAULT_SETTINGS.prompt;
						await saveSettings(this.plugin);
						if (settings.autoClearCache) await clearCache();
						new Notice("Prompt reset to default");
						this.display();
					}),
			);

		new Setting(containerEl)
			.setName("Auto clear cache")
			.setDesc("Clear the cache after changing the model or the prompt to reanalyze images")
			.addToggle((toggle) => toggle.setValue(settings.autoClearCache).onChange(async (value) => {
				settings.autoClearCache = value;
				if (value) { await clearCache(); new Notice("Cache cleared"); }
				await saveSettings(this.plugin);
			}));
	}
}

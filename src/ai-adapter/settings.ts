import { Setting } from "obsidian";
import { Models, providerNames, Providers } from "./types";
import { DEFAULT_OLLAMA_SETTINGS, OllamaSettings } from "./providers/ollamaProvider";
import { possibleModels, setProvider, provider, notifyModelsChange } from "./globals";
import { initProvider } from "./util";
import { DEFAULT_GEMINI_SETTINGS, GeminiSettings } from "./providers/geminiProvider";
import { DEFAULT_AGNES_SETTINGS, AgnesSettings } from "./providers/agnesProvider";
import { DEFAULT_OPENAI_COMPATIBLE_SETTINGS, OpenAICompatibleSettings } from "./providers/openaiCompatibleProvider";
import AIImageAnalyzerPlugin from "../main";
import { saveSettings, settings } from "../settings";

export type AIAdapterPluginSettings = {
	provider: Providers;
	selectedModel: Models;
	selectedImageModel: Models;
	ollamaSettings: OllamaSettings;
	geminiSettings: GeminiSettings;
	agnesSettings: AgnesSettings;
	openaiCompatibleSettings: OpenAICompatibleSettings;
};

export const DEFAULT_SETTINGS: AIAdapterPluginSettings = {
	provider: "agnes",
	selectedModel: possibleModels[8],
	selectedImageModel: possibleModels[0],
	ollamaSettings: DEFAULT_OLLAMA_SETTINGS,
	geminiSettings: DEFAULT_GEMINI_SETTINGS,
	agnesSettings: DEFAULT_AGNES_SETTINGS,
	openaiCompatibleSettings: DEFAULT_OPENAI_COMPATIBLE_SETTINGS,
};

export function generateSettings(containerEl: HTMLElement, plugin: AIImageAnalyzerPlugin) {
	new Setting(containerEl)
		.setName("Provider")
		.setDesc("Select the provider to use")
		.addDropdown((dropdown) =>
			dropdown
				.addOptions(providerNames.reduce((acc, p) => { acc[p] = p; return acc; }, {} as Record<Providers, string>))
				.setValue(settings.aiAdapterSettings.provider)
				.onChange(async (value: string) => {
					settings.aiAdapterSettings.provider = value as Providers;
					setProvider(initProvider());
					settings.aiAdapterSettings.selectedModel = provider.lastModel ?? possibleModels[0];
					settings.aiAdapterSettings.selectedImageModel = provider.lastImageModel ?? possibleModels[0];
					await saveSettings(plugin);
					notifyModelsChange();
				}),
		);

	new Setting(containerEl)
		.setName("Image model")
		.setDesc("Select the image model to use")
		.addDropdown((dropdown) =>
			dropdown
				.addOptions(
					possibleModels
						.filter((m: Models) => m.provider == settings.aiAdapterSettings.provider && m.imageReady)
						.reduce((acc, m) => { acc[m.name] = m.name; return acc; }, {} as Record<string, string>),
				)
				.setValue(settings.aiAdapterSettings.selectedImageModel.name)
				.onChange(async (value) => {
					settings.aiAdapterSettings.selectedImageModel = possibleModels.find((m) => m.name === value)!;
					provider.setLastImageModel(settings.aiAdapterSettings.selectedImageModel);
					await saveSettings(plugin);
				}),
		);

	provider.generateSettings(containerEl, plugin);
}

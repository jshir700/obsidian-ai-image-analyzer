import AIImageAnalyzerPlugin from "../../main";
import { Setting } from "obsidian";
import { Provider } from "../provider";
import { Models } from "../types";
import { possibleModels } from "../globals";
import { saveSettings, settings } from "../../settings";
import { debugLog } from "../../util";

const context = "ai-adapter/providers/openaiCompatibleProvider";

let openaiCompatibleBaseUrl: string = "";
let openaiCompatibleApiKey: string = "";
let openaiCompatibleModel: string = "gpt-4o";
let openaiCompatibleUseUrl: boolean = true;
let openaiCompatibleUseBase64: boolean = true;

export type OpenAICompatibleSettings = {
	lastModel: Models;
	lastImageModel: Models;
	apiKey: string;
	baseUrl: string;
	model: string;
	useUrl: boolean;
	useBase64: boolean;
};

export const DEFAULT_OPENAI_COMPATIBLE_SETTINGS: OpenAICompatibleSettings = {
	lastModel: possibleModels[0],
	lastImageModel: possibleModels[0],
	apiKey: "",
	baseUrl: "",
	model: "gpt-4o",
	useUrl: true,
	useBase64: true,
};

function getOpenAICompatSettings(): OpenAICompatibleSettings {
	const adapterSettings = settings.aiAdapterSettings as Record<string, unknown>;
	const s = adapterSettings.openaiCompatibleSettings as OpenAICompatibleSettings | undefined;
	if (s) return s;
	const newSettings: OpenAICompatibleSettings = Object.assign({}, DEFAULT_OPENAI_COMPATIBLE_SETTINGS);
	if (!adapterSettings.openaiCompatibleSettings) adapterSettings.openaiCompatibleSettings = newSettings;
	return newSettings;
}

function setOpenAICompatSettingsValue(key: keyof OpenAICompatibleSettings, value: unknown): void {
	const adapterSettings = settings.aiAdapterSettings as Record<string, unknown>;
	let s = adapterSettings.openaiCompatibleSettings as OpenAICompatibleSettings | undefined;
	if (!s) {
		s = Object.assign({}, DEFAULT_OPENAI_COMPATIBLE_SETTINGS);
		adapterSettings.openaiCompatibleSettings = s;
	}
	(s as any)[key] = value;
}

export class OpenAICompatibleProvider extends Provider {
	constructor() {
		super();
		const s = getOpenAICompatSettings();
		openaiCompatibleBaseUrl = s.baseUrl;
		openaiCompatibleApiKey = s.apiKey;
		openaiCompatibleModel = s.model;
		openaiCompatibleUseUrl = s.useUrl;
		openaiCompatibleUseBase64 = s.useBase64;
		this.lastModel = s.lastModel ?? possibleModels[0];
		this.lastImageModel = s.lastImageModel ?? possibleModels[0];
	}

	generateSettings(containerEl: HTMLElement, plugin: AIImageAnalyzerPlugin) {
		new Setting(containerEl).setName("OpenAI Compatible").setHeading();
		new Setting(containerEl)
			.setName("Base URL")
			.setDesc("API endpoint URL (e.g. https://api.openai.com/v1)")
			.addText((text) =>
				text.setPlaceholder("https://api.openai.com/v1").setValue(getOpenAICompatSettings().baseUrl)
					.onChange(async (value) => {
						setOpenAICompatSettingsValue("baseUrl", value);
						openaiCompatibleBaseUrl = value;
						await saveSettings(plugin);
					}),
			);
		new Setting(containerEl)
			.setName("API Key")
			.setDesc("Your API key")
			.addText((text) =>
				text.setValue(getOpenAICompatSettings().apiKey !== "" ? "••••••••••" : "")
					.onChange(async (value) => {
						if (value.includes("•")) return;
						setOpenAICompatSettingsValue("apiKey", value);
						openaiCompatibleApiKey = value;
						await saveSettings(plugin);
					}),
			);
		new Setting(containerEl)
			.setName("Model")
			.setDesc("Model name (e.g. gpt-4o, claude-vision)")
			.addText((text) =>
				text.setPlaceholder("gpt-4o").setValue(getOpenAICompatSettings().model)
					.onChange(async (value) => {
						setOpenAICompatSettingsValue("model", value);
						openaiCompatibleModel = value;
						await saveSettings(plugin);
					}),
			);
		new Setting(containerEl)
			.setName("Prefer URL input")
			.setDesc("Try extracting image URL from note first")
			.addToggle((toggle) =>
				toggle.setValue(getOpenAICompatSettings().useUrl)
					.onChange(async (value) => {
						setOpenAICompatSettingsValue("useUrl", value);
						openaiCompatibleUseUrl = value;
						await saveSettings(plugin);
					}),
			);
		new Setting(containerEl)
			.setName("Fallback to base64")
			.setDesc("If URL extraction fails, fall back to reading local file as base64")
			.addToggle((toggle) =>
				toggle.setValue(getOpenAICompatSettings().useBase64)
					.onChange(async (value) => {
						setOpenAICompatSettingsValue("useBase64", value);
						openaiCompatibleUseBase64 = value;
						await saveSettings(plugin);
					}),
			);
	}

	async queryHandling(prompt: string): Promise<string> {
		const response = await fetch(openaiCompatibleBaseUrl + "/chat/completions", {
			method: "POST",
			headers: { "Authorization": "Bearer " + openaiCompatibleApiKey, "Content-Type": "application/json" },
			body: JSON.stringify({ model: openaiCompatibleModel, messages: [{ role: "user", content: prompt }] }),
		});
		if (!response.ok) { const errText = await response.text(); return "[AI-ERROR] OpenAI Compatible API error: " + errText; }
		const data = await response.json();
		const text = data.choices?.[0]?.message?.content;
		return text ? text : "[AI-ERROR] No response from API";
	}

	async queryWithImageUrlHandling(prompt: string, imageUrl: string): Promise<string> {
		const response = await fetch(openaiCompatibleBaseUrl + "/chat/completions", {
			method: "POST",
			headers: { "Authorization": "Bearer " + openaiCompatibleApiKey, "Content-Type": "application/json" },
			body: JSON.stringify({
				model: openaiCompatibleModel,
				messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageUrl } }] }],
			}),
		});
		if (!response.ok) { const errText = await response.text(); return "[AI-ERROR] OpenAI Compatible API error: " + errText; }
		const data = await response.json();
		const text = data.choices?.[0]?.message?.content;
		return text ? text : "[AI-ERROR] No response from API";
	}

	async queryWithBase64Handling(prompt: string, imageBase64: string, mimeType: string = "image/png"): Promise<string> {
		const response = await fetch(openaiCompatibleBaseUrl + "/chat/completions", {
			method: "POST",
			headers: { "Authorization": "Bearer " + openaiCompatibleApiKey, "Content-Type": "application/json" },
			body: JSON.stringify({
				model: openaiCompatibleModel,
				messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: "data:" + mimeType + ";base64," + imageBase64 } }] }],
			}),
		});
		if (!response.ok) { const errText = await response.text(); return "[AI-ERROR] OpenAI Compatible API error: " + errText; }
		const data = await response.json();
		const text = data.choices?.[0]?.message?.content;
		return text ? text : "[AI-ERROR] No response from API";
	}

	queryWithImageHandling(prompt: string, imageBase64: string): Promise<string> {
		if (openaiCompatibleUseUrl && !openaiCompatibleUseBase64) {
			return Promise.reject("OpenAI Compatible provider requires URL input. Check settings.");
		}
		return this.queryWithBase64Handling(prompt, imageBase64);
	}

	setLastModel(model: Models) {
		super.setLastModel(model);
		setOpenAICompatSettingsValue("lastModel", model);
	}
	setLastImageModel(model: Models) {
		super.setLastImageModel(model);
		setOpenAICompatSettingsValue("lastImageModel", model);
	}
}

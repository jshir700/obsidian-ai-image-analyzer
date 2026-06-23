import AIImageAnalyzerPlugin from "../../main";
import { Setting } from "obsidian";
import { Provider } from "../provider";
import { Models } from "../types";
import { possibleModels } from "../globals";
import { saveSettings, settings } from "../../settings";
import { debugLog } from "../../util";

const context = "ai-adapter/providers/agnesProvider";

let agnesApiKey: string = "";
let agnesBaseUrl: string = "https://apihub.agnes-ai.com/v1";
let agnesModel: string = "agnes-2.0-flash";

export type AgnesSettings = {
	lastModel: Models;
	lastImageModel: Models;
	apiKey: string;
	baseUrl: string;
	model: string;
};

export const DEFAULT_AGNES_SETTINGS: AgnesSettings = {
	lastModel: possibleModels[0],
	lastImageModel: possibleModels[0],
	apiKey: "",
	baseUrl: "https://apihub.agnes-ai.com/v1",
	model: "agnes-2.0-flash",
};

function getAgnesSettings(): AgnesSettings {
	const adapterSettings = settings.aiAdapterSettings as Record<string, unknown>;
	const agnesSettings = adapterSettings.agnesSettings as AgnesSettings | undefined;
	if (agnesSettings) return agnesSettings;
	const newSettings: AgnesSettings = Object.assign({}, DEFAULT_AGNES_SETTINGS);
	if (!adapterSettings.agnesSettings) adapterSettings.agnesSettings = newSettings;
	return newSettings;
}

function setAgnesSettingsValue(key: keyof AgnesSettings, value: unknown): void {
	const adapterSettings = settings.aiAdapterSettings as Record<string, unknown>;
	let agnesSettings = adapterSettings.agnesSettings as AgnesSettings | undefined;
	if (!agnesSettings) {
		agnesSettings = Object.assign({}, DEFAULT_AGNES_SETTINGS);
		adapterSettings.agnesSettings = agnesSettings;
	}
	(adapterSettings.agnesSettings as AgnesSettings)[key] = value as any;
}

export class AgnesProvider extends Provider {
	constructor() {
		super();
		const s = getAgnesSettings();
		agnesApiKey = s.apiKey;
		agnesBaseUrl = s.baseUrl;
		agnesModel = s.model;
		this.lastModel = s.lastModel ?? possibleModels[0];
		this.lastImageModel = s.lastImageModel ?? possibleModels[0];
	}

	generateSettings(containerEl: HTMLElement, plugin: AIImageAnalyzerPlugin) {
		new Setting(containerEl).setName("Agnes").setHeading();
		new Setting(containerEl)
			.setName("Agnes API Key")
			.setDesc("Set your Agnes API key")
			.addText((text) =>
				text.setValue(getAgnesSettings().apiKey !== "" ? "••••••••••" : "")
					.onChange(async (value) => {
						if (value.includes("•")) return;
						setAgnesSettingsValue("apiKey", value);
						agnesApiKey = value;
						await saveSettings(plugin);
					}),
			);
		new Setting(containerEl)
			.setName("Base URL")
			.setDesc("Agnes API base URL")
			.addText((text) =>
				text.setPlaceholder("https://apihub.agnes-ai.com/v1").setValue(getAgnesSettings().baseUrl)
					.onChange(async (value) => {
						setAgnesSettingsValue("baseUrl", value);
						agnesBaseUrl = value;
						await saveSettings(plugin);
					}),
			);
		new Setting(containerEl)
			.setName("Model")
			.setDesc("Agnes model for image analysis")
			.addText((text) =>
				text.setPlaceholder("agnes-2.0-flash").setValue(getAgnesSettings().model)
					.onChange(async (value) => {
						setAgnesSettingsValue("model", value);
						agnesModel = value;
						await saveSettings(plugin);
					}),
			);
	}

	async queryHandling(prompt: string): Promise<string> {
		const response = await fetch(agnesBaseUrl + "/chat/completions", {
			method: "POST",
			headers: { "Authorization": "Bearer " + agnesApiKey, "Content-Type": "application/json" },
			body: JSON.stringify({ model: agnesModel, messages: [{ role: "user", content: prompt }] }),
		});
		if (!response.ok) { const errText = await response.text(); return "[AI-ERROR] Agnes API error: " + errText; }
		const data = await response.json();
		const text = data.choices?.[0]?.message?.content;
		return text ? text : "[AI-ERROR] No response from Agnes API";
	}

	async queryWithImageUrlHandling(prompt: string, imageUrl: string): Promise<string> {
		const response = await fetch(agnesBaseUrl + "/chat/completions", {
			method: "POST",
			headers: { "Authorization": "Bearer " + agnesApiKey, "Content-Type": "application/json" },
			body: JSON.stringify({
				model: agnesModel,
				messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageUrl } }] }],
			}),
		});
		if (!response.ok) { const errText = await response.text(); return "[AI-ERROR] Agnes API error: " + errText; }
		const data = await response.json();
		const text = data.choices?.[0]?.message?.content;
		return text ? text : "[AI-ERROR] No response from Agnes API";
	}

	queryWithImageHandling(_prompt: string, _image: string): Promise<string> {
		return Promise.reject("Agnes provider only supports URL-based image input. Please use a note with image URLs.");
	}

	setLastModel(model: Models) {
		super.setLastModel(model);
		setAgnesSettingsValue("lastModel", model);
	}
	setLastImageModel(model: Models) {
		super.setLastImageModel(model);
		setAgnesSettingsValue("lastImageModel", model);
	}
}

import { settings } from "../settings";
import { Provider } from "./provider";
import { OllamaProvider } from "./providers/ollamaProvider";
import { GeminiProvider } from "./providers/geminiProvider";
import { AgnesProvider } from "./providers/agnesProvider";
import { OpenAICompatibleProvider } from "./providers/openaiCompatibleProvider";
import { provider } from "./globals";
import { Notice } from "obsidian";
import { debugLog } from "../util";

const context = "ai-adapter/util";

export function initProvider(): Provider {
	debugLog(context, "Initializing provider: " + settings.aiAdapterSettings.provider);
	switch (settings.aiAdapterSettings.provider) {
		case "ollama": return new OllamaProvider();
		case "gemini": return new GeminiProvider();
		case "agnes": return new AgnesProvider();
		case "openai-compatible": return new OpenAICompatibleProvider();
		default:
			debugLog(context, "Unknown provider, falling back to ollama");
			return new OllamaProvider();
	}
}

export function checkProviderReady() {
	if (!provider) {
		debugLog(context, "Provider not initialized");
		new Notice("Provider not initialized");
		throw new Error("Provider not initialized");
	}
}

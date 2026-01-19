import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import TuonDeepResearchPlugin from "./main";
import { showTestResultToast, testOpenRouterApiKey } from "./ai/openrouterDiagnostics";

export interface DeepResearchSettings {
	deepResearchServerUrl: string;
	deepResearchApiKey: string;
	openRouterApiKey: string;
	openRouterModel: string;
	openRouterReferer: string;
	openRouterAppTitle: string;
	autoOptimizePrompt: boolean;
	includeOptimizedPromptInNote: boolean;
	outputFolder: string;
	pollIntervalMs: number;
	localUserId: string;
}

export const DEFAULT_SETTINGS: DeepResearchSettings = {
	deepResearchServerUrl: "https://tuon-deep-research.onrender.com",
	deepResearchApiKey: "",
	openRouterApiKey: "",
	openRouterModel: "openai/gpt-oss-120b",
	openRouterReferer: "",
	openRouterAppTitle: "Tuon Deep Research",
	autoOptimizePrompt: false,
	includeOptimizedPromptInNote: true,
	outputFolder: "Deep Research",
	pollIntervalMs: 4000,
	localUserId: "",
};

export class DeepResearchSettingTab extends PluginSettingTab {
	plugin: TuonDeepResearchPlugin;

	constructor(app: App, plugin: TuonDeepResearchPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h3", { text: "Deep Research server" });

		new Setting(containerEl)
			.setName("Server URL")
			.setDesc("Base URL for the Tuon Deep Research server.")
			.addText((text) =>
				text
					.setPlaceholder("https://tuon-deep-research.onrender.com")
					.setValue(this.plugin.settings.deepResearchServerUrl)
					.onChange(async (value) => {
						this.plugin.settings.deepResearchServerUrl = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Server API key (optional)")
			.setDesc("If the server requires API_SECRET_KEY, set it here.")
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("sk-...")
					.setValue(this.plugin.settings.deepResearchApiKey)
					.onChange(async (value) => {
						this.plugin.settings.deepResearchApiKey = value.trim();
						await this.plugin.saveSettings();
					});
				return text;
			});

		new Setting(containerEl)
			.setName("Polling interval (ms)")
			.setDesc("How often to poll job status.")
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.pollIntervalMs))
					.setValue(String(this.plugin.settings.pollIntervalMs))
					.onChange(async (value) => {
						const parsed = Number(value);
						this.plugin.settings.pollIntervalMs =
							Number.isFinite(parsed) && parsed >= 1000 ? Math.round(parsed) : DEFAULT_SETTINGS.pollIntervalMs;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: "Prompt optimization (OpenRouter)" });

		new Setting(containerEl)
			.setName("OpenRouter API key")
			.setDesc("Used to optimize prompts before submission.")
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("sk-or-...")
					.setValue(this.plugin.settings.openRouterApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openRouterApiKey = value.trim();
						await this.plugin.saveSettings();
					});
				return text;
			})
			.addButton((btn) =>
				btn
					.setButtonText("Test")
					.onClick(async () => {
						const result = await testOpenRouterApiKey({
							apiKey: this.plugin.settings.openRouterApiKey,
							model: this.plugin.settings.openRouterModel,
							referer: this.plugin.settings.openRouterReferer,
							appTitle: this.plugin.settings.openRouterAppTitle,
						});
						showTestResultToast(result);
					})
			);

		new Setting(containerEl)
			.setName("OpenRouter model")
			.setDesc('Example: "openai/gpt-5-mini", "anthropic/claude-3.5-sonnet".')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.openRouterModel)
					.setValue(this.plugin.settings.openRouterModel)
					.onChange(async (value) => {
						this.plugin.settings.openRouterModel = value.trim() || DEFAULT_SETTINGS.openRouterModel;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("OpenRouter referer (optional)")
			.setDesc("If set, sent as HTTP-Referer header for attribution.")
			.addText((text) =>
				text
					.setPlaceholder("https://example.com")
					.setValue(this.plugin.settings.openRouterReferer)
					.onChange(async (value) => {
						this.plugin.settings.openRouterReferer = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Include optimized prompt in report note")
			.setDesc("Adds a collapsible prompt section to the final report note.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeOptimizedPromptInNote)
					.onChange(async (value) => {
						this.plugin.settings.includeOptimizedPromptInNote = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: "Output" });

		new Setting(containerEl)
			.setName("Reports folder")
			.setDesc("Folder where final research notes are created.")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.outputFolder)
					.setValue(this.plugin.settings.outputFolder)
					.onChange(async (value) => {
						this.plugin.settings.outputFolder = value.trim() || DEFAULT_SETTINGS.outputFolder;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Reset local user ID")
			.setDesc("Regenerates the local user identifier stored in the plugin settings.")
			.addButton((btn) =>
				btn.setButtonText("Reset").onClick(async () => {
					this.plugin.settings.localUserId = "";
					await this.plugin.ensureLocalUserId();
					new Notice("Local user ID regenerated.");
				})
			);
	}
}

import { App, Modal, Notice, Setting } from "obsidian";
import { DeepResearchSettings } from "../settings";
import { optimizePrompt } from "../ai/promptOptimizer";
import { ResearchJobManager } from "../research/jobManager";

export class ResearchModal extends Modal {
	private settings: DeepResearchSettings;
	private jobManager: ResearchJobManager;
	private promptInput!: HTMLTextAreaElement;
	private optimizedOutput!: HTMLTextAreaElement;
	private optimizeButton!: HTMLButtonElement;
	private submitButton!: HTMLButtonElement;
	private optimizing = false;
	private optimizedPrompt = "";

	constructor(app: App, settings: DeepResearchSettings, jobManager: ResearchJobManager) {
		super(app);
		this.settings = settings;
		this.jobManager = jobManager;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("tuon-research-modal");

		contentEl.createEl("h2", { text: "Deep Research" });

		this.promptInput = contentEl.createEl("textarea", {
			cls: "tuon-research-textarea",
			attr: { placeholder: "Enter your research prompt..." },
		});

		const controls = contentEl.createDiv({ cls: "tuon-research-controls" });
		this.optimizeButton = controls.createEl("button", { text: "Optimize prompt" });
		this.submitButton = controls.createEl("button", { text: "Run research" });

		contentEl.createEl("label", { text: "Optimized prompt (preview)" });
		this.optimizedOutput = contentEl.createEl("textarea", {
			cls: "tuon-research-textarea",
		});
		this.optimizedOutput.readOnly = true;

		this.optimizeButton.addEventListener("click", () => void this.handleOptimize());
		this.submitButton.addEventListener("click", () => void this.handleSubmit());
	}

	private async handleOptimize() {
		const rawPrompt = this.promptInput.value.trim();
		if (!rawPrompt) {
			new Notice("Enter a prompt first.");
			return;
		}
		if (!this.settings.openRouterApiKey?.trim()) {
			new Notice("Missing OpenRouter API key. Set it in plugin settings.");
			return;
		}
		this.setOptimizing(true);
		try {
			this.optimizedPrompt = await optimizePrompt(
				{
					apiKey: this.settings.openRouterApiKey,
					model: this.settings.openRouterModel,
					referer: this.settings.openRouterReferer,
					appTitle: this.settings.openRouterAppTitle,
				},
				rawPrompt
			);
			this.optimizedOutput.value = this.optimizedPrompt;
			new Notice("Prompt optimized.");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`Prompt optimization failed: ${msg}`);
		} finally {
			this.setOptimizing(false);
		}
	}

	private async handleSubmit() {
		const rawPrompt = this.promptInput.value.trim();
		if (!rawPrompt) {
			new Notice("Enter a prompt first.");
			return;
		}

		const optimizedPrompt = this.optimizedPrompt.trim();
		const promptToUse = optimizedPrompt ? optimizedPrompt : rawPrompt;
		const usedOptimized = !!optimizedPrompt;
		const now = new Date().toISOString();
		try {
			await this.jobManager.submitJob({
				originalPrompt: rawPrompt,
				optimizedPrompt: promptToUse,
				optimizerMeta: {
					optimizedAt: usedOptimized ? now : null,
					model: this.settings.openRouterModel,
					autoOptimize: false,
					usedOptimized,
				},
			});
			new Notice("Research job submitted.");
			this.close();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`Research submission failed: ${msg}`);
		}
	}

	private setOptimizing(value: boolean) {
		this.optimizing = value;
		this.optimizeButton.disabled = value;
		this.submitButton.disabled = value;
	}
}

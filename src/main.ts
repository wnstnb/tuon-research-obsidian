import { Notice, Plugin } from "obsidian";
import { DeepResearchSettingTab, DEFAULT_SETTINGS, DeepResearchSettings } from "./settings";
import { SCHEMA_STATEMENTS } from "./db/schema";
import { SqliteService } from "./db/sqliteService";
import { ResearchRepo } from "./db/researchRepo";
import { DeepResearchClient } from "./research/deepResearchClient";
import { ReportNoteWriter } from "./research/reportNoteWriter";
import { ResearchJobManager } from "./research/jobManager";
import { ResearchModal } from "./ui/ResearchModal";
import { ResearchJobsView, VIEW_TYPE_RESEARCH_JOBS } from "./ui/ResearchJobsView";

export default class TuonDeepResearchPlugin extends Plugin {
	settings: DeepResearchSettings;
	private db!: SqliteService;
	private repo!: ResearchRepo;
	private client!: DeepResearchClient;
	private noteWriter!: ReportNoteWriter;
	private jobManager!: ResearchJobManager;

	async onload() {
		await this.loadSettings();
		await this.ensureLocalUserId();

		this.db = new SqliteService(this.app, this.manifest.id);
		await this.db.init();
		SCHEMA_STATEMENTS.forEach((stmt) => this.db.exec(stmt));

		this.repo = new ResearchRepo(this.db);
		this.client = new DeepResearchClient(
			this.settings.deepResearchServerUrl,
			this.settings.deepResearchApiKey
		);
		this.noteWriter = new ReportNoteWriter(this.app);
		this.jobManager = new ResearchJobManager(
			this.repo,
			this.client,
			this.noteWriter,
			this.settings.localUserId,
			this.settings.pollIntervalMs,
			this.settings.outputFolder,
			this.settings.includeOptimizedPromptInNote
		);

		this.registerView(VIEW_TYPE_RESEARCH_JOBS, (leaf) => new ResearchJobsView(leaf, this.repo));

		this.addRibbonIcon("search", "Deep Research", () => {
			new ResearchModal(this.app, this.settings, this.jobManager).open();
		});

		this.addCommand({
			id: "tuon-deep-research-open-modal",
			name: "Tuon: Deep Research",
			callback: () => {
				new ResearchModal(this.app, this.settings, this.jobManager).open();
			},
		});

		this.addCommand({
			id: "tuon-deep-research-open-jobs",
			name: "Tuon: Open Deep Research jobs",
			callback: () => {
				void this.activateJobsView();
			},
		});

		this.addSettingTab(new DeepResearchSettingTab(this.app, this));
	}

	onunload() {
		void this.db?.close();
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<DeepResearchSettings>
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		if (this.client) {
			this.client.updateConfig(this.settings.deepResearchServerUrl, this.settings.deepResearchApiKey);
		}
		if (this.jobManager) {
			this.jobManager.updateConfig(
				this.settings.pollIntervalMs,
				this.settings.outputFolder,
				this.settings.includeOptimizedPromptInNote
			);
		}
	}

	async ensureLocalUserId(): Promise<void> {
		if (this.settings.localUserId) return;
		if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
			this.settings.localUserId = crypto.randomUUID();
		} else {
			this.settings.localUserId = `local_${Date.now()}`;
		}
		await this.saveSettings();
		new Notice("Initialized local user ID for Deep Research.");
	}

	private async activateJobsView(): Promise<void> {
		const leaf =
			this.app.workspace.getLeavesOfType(VIEW_TYPE_RESEARCH_JOBS)[0] ||
			this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE_RESEARCH_JOBS, active: true });
		this.app.workspace.revealLeaf(leaf);
	}
}

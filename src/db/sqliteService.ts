import { App } from "obsidian";
import initSqlJs from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";

type SqlParams = Array<string | number | null | Uint8Array>;

export class SqliteService {
	private app: App;
	private pluginId: string;
	private db: Database | null = null;
	private sql: SqlJsStatic | null = null;
	private dbPath: string;
	private saveTimer: number | null = null;
	private dirty = false;

	constructor(app: App, pluginId: string) {
		this.app = app;
		this.pluginId = pluginId;
		const configDir = this.app.vault.configDir || ".obsidian";
		this.dbPath = `${configDir}/plugins/${pluginId}/tuon-research.sqlite`;
	}

	async init(): Promise<void> {
		if (this.db) return;
		await this.ensurePluginDir();
		const sql = await initSqlJs({
			locateFile: (file) => this.getAssetPath(file),
		});
		this.sql = sql;
		const data = await this.readDbFile();
		this.db = data ? new sql.Database(data) : new sql.Database();
		this.db.exec("PRAGMA foreign_keys = ON;");
	}

	get isReady(): boolean {
		return !!this.db;
	}

	exec(sql: string): void {
		this.ensureReady();
		this.db!.exec(sql);
		this.markDirty();
	}

	run(sql: string, params: SqlParams = []): void {
		this.ensureReady();
		const stmt = this.db!.prepare(sql);
		try {
			stmt.bind(params);
			stmt.step();
		} finally {
			stmt.free();
		}
		this.markDirty();
	}

	get<T = Record<string, any>>(sql: string, params: SqlParams = []): T | null {
		this.ensureReady();
		const stmt = this.db!.prepare(sql);
		try {
			stmt.bind(params);
			if (!stmt.step()) return null;
			return stmt.getAsObject() as T;
		} finally {
			stmt.free();
		}
	}

	all<T = Record<string, any>>(sql: string, params: SqlParams = []): T[] {
		this.ensureReady();
		const stmt = this.db!.prepare(sql);
		const rows: T[] = [];
		try {
			stmt.bind(params);
			while (stmt.step()) {
				rows.push(stmt.getAsObject() as T);
			}
		} finally {
			stmt.free();
		}
		return rows;
	}

	async flush(): Promise<void> {
		if (!this.db || !this.dirty) return;
		await this.writeDbFile(this.db.export());
		this.dirty = false;
	}

	async close(): Promise<void> {
		await this.flush();
		this.db?.close();
		this.db = null;
	}

	private markDirty(): void {
		this.dirty = true;
		this.scheduleSave();
	}

	private scheduleSave(): void {
		if (this.saveTimer !== null) return;
		this.saveTimer = window.setTimeout(async () => {
			this.saveTimer = null;
			await this.flush();
		}, 1000);
	}

	private ensureReady(): void {
		if (!this.db) {
			throw new Error("SQLite database not initialized.");
		}
	}

	private async ensurePluginDir(): Promise<void> {
		const dir = this.dbPath.split("/").slice(0, -1).join("/");
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(dir))) {
			await adapter.mkdir(dir);
		}
	}

	private async readDbFile(): Promise<Uint8Array | null> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(this.dbPath))) return null;
		const data = await adapter.readBinary(this.dbPath);
		return new Uint8Array(data);
	}

	private async writeDbFile(data: Uint8Array): Promise<void> {
		const adapter = this.app.vault.adapter;
		await adapter.writeBinary(this.dbPath, data);
	}

	private getAssetPath(file: string): string {
		const configDir = this.app.vault.configDir || ".obsidian";
		const relPath = `${configDir}/plugins/${this.pluginId}/${file}`;
		return this.app.vault.adapter.getResourcePath(relPath);
	}
}

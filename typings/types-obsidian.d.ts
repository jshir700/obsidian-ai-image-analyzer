import type {} from "obsidian";

declare module "obsidian" {
	interface MenuItem {
		setSubmenu(): Menu;
	}
}

// Global Obsidian app reference
declare global {
	const app: any;
}

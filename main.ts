import { App, Editor, MarkdownView, Plugin, Notice, PluginSettingTab, Setting } from 'obsidian';

interface ButtondownPluginSettings {
	APIKey: string;
}

const DEFAULT_SETTINGS: ButtondownPluginSettings = {
	APIKey: ''
}

export default class ButtondownPlugin extends Plugin {
	settings: ButtondownPluginSettings;
	async saveDraft(title: string, body: string): Promise<void> {
		if (!this.settings.APIKey) {
			new Notice("Please set your API key in the settings!");
			return;
		}
		try {
			const result = await fetch("https://api.buttondown.email/v1/drafts", {
				method: "POST",
				headers: new Headers({
					Authorization: `Token ${this.settings.APIKey}`,
					"Content-Type": "application/json",
				}),
				body: JSON.stringify({
					"body": body,
					"subject": title
				}),
			});

			if (result.ok) {
				new Notice("Sent draft to Buttondown");
			} else {
				console.error("Error - something went wrong: ", result);
				new Notice("Something went wrong sending draft to Buttondown. Please check the console for more info");
			}
		} catch (e) {
			console.error("Error - something went wrong: ", e);
			new Notice("Something went wrong sending draft to Buttondown. Please check the console for more info");
		}

	}
	async onload() {
		console.log("Loading buttondown plugin");
		await this.loadSettings();
		this.addCommand({
			id: 'note-to-buttondown-draft',
			name: 'Create a new Buttondown draft from this note',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.saveDraft(view.file.basename, editor.getValue())
			}
		});

		this.addSettingTab(new SampleSettingTab(this.app, this))
	}

	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: ButtondownPlugin;

	constructor(app: App, plugin: ButtondownPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Buttondown Settings' });

		new Setting(containerEl)
			.setName('API key')
			.setDesc('Find it at https://buttondown.email/settings/programming')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.APIKey)
				.onChange(async (value) => {
					value.replace(/-/, "");
					this.plugin.settings.APIKey = value;
					await this.plugin.saveSettings();
				})
			);
	}
}

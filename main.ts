import { App, Editor, MarkdownView, Plugin, Notice, PluginSettingTab, Setting, TFile } from 'obsidian';

interface ButtondownPluginSettings {
	APIKey: string;
}

const DEFAULT_SETTINGS: ButtondownPluginSettings = {
	APIKey: ''
}

export default class ButtondownPlugin extends Plugin {
	settings: ButtondownPluginSettings;
	
	async uploadImage(file: TFile): Promise<string | null> {
		if (!this.settings.APIKey) {
			return null;
		}
		
		try {
			const arrayBuffer = await this.app.vault.readBinary(file);
			const formData = new FormData();
			formData.append('image', new Blob([arrayBuffer], { type: `image/${file.extension}` }), file.name);
			
			const result = await fetch("https://api.buttondown.email/v1/images", {
				method: "POST",
				headers: {
					Authorization: `Token ${this.settings.APIKey}`,
				},
				body: formData,
			});
			
			if (result.ok) {
				const response = await result.json();
				return response.image;
			}
		} catch (e) {
			console.error("Error uploading image: ", e);
		}
		return null;
	}
	
	async processImagesInContent(content: string): Promise<string> {
		const imagePatterns = [
			/!\[([^\]]*)\]\(([^)]+)\)/g,  // ![alt](path)
			/!\[\[([^\]]+)\]\]/g          // ![[path]]
		];
		
		let processedContent = content;
		
		for (const pattern of imagePatterns) {
			const matches = [...content.matchAll(pattern)];
			for (const match of matches) {
				const [fullMatch, altOrPath, pathOrUndefined] = match;
				const imagePath = pathOrUndefined || altOrPath; // Handle both formats
				const altText = pathOrUndefined ? altOrPath : '';
				
				const file = this.app.metadataCache.getFirstLinkpathDest(imagePath, '');
				if (file?.extension && ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(file.extension.toLowerCase())) {
					const uploadedImageUrl = await this.uploadImage(file);
					if (uploadedImageUrl) {
						processedContent = processedContent.replace(fullMatch, `![${altText}](${uploadedImageUrl})`);
					}
				}
			}
		}
		
		return processedContent;
	}
	
	async saveDraft(title: string, body: string): Promise<void> {
		if (!this.settings.APIKey) {
			new Notice("Please set your API key in the settings!");
			return;
		}
		try {
			const processedBody = await this.processImagesInContent(body);
			const result = await fetch("https://api.buttondown.email/v1/emails", {
				method: "POST",
				headers: new Headers({
					Authorization: `Token ${this.settings.APIKey}`,
					"Content-Type": "application/json",
				}),
				body: JSON.stringify({
					"body": processedBody,
					"subject": title,
					"status": "draft",
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
			.setDesc('Find it at https://buttondown.email/settings#api')
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

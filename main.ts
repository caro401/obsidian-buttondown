import { App, Editor, MarkdownView, Plugin, Notice, PluginSettingTab, Setting, TFile } from 'obsidian';
import imageCompression from 'browser-image-compression';

const SIDE_OPTIONS = ['longest', 'height', 'width'] as const;
type sidePreference = typeof SIDE_OPTIONS[number];

interface ButtondownPluginSettings {
	APIKey: string;
	sidePreference: sidePreference;
	resizeLimit: number;
}

const DEFAULT_SETTINGS: ButtondownPluginSettings = {
	APIKey: '',
	sidePreference: 'longest',
	resizeLimit: 1200
}

export default class ButtondownPlugin extends Plugin {
	settings: ButtondownPluginSettings;
	
	async uploadImage(file: TFile): Promise<string | null> {
		if (!this.settings.APIKey) {
			return null;
		}

		try {
			const arrayBuffer = await this.app.vault.readBinary(file);
			// browser-image-compression requires a File to work with, so first construct a new File
			const imageFile = new File( 
			[arrayBuffer], 
			file.name, 
			{ type: `image/${file.extension}` }
			);
			
			const img = await createImageBitmap(imageFile);
			const { width, height } = img;
			
			// Determining resize constraint
			let maxWidthOrHeight: number | undefined;
			switch (this.settings.sidePreference) {
				case 'longest':
					maxWidthOrHeight = this.settings.resizeLimit;
					break;
				case 'width':
					maxWidthOrHeight = width > this.settings.resizeLimit ? this.settings.resizeLimit : undefined;
					break;
				case 'height':
					maxWidthOrHeight = height > this.settings.resizeLimit ? this.settings.resizeLimit : undefined;
					break;
			};

			// Resizing image
			let processedFile = imageFile;
			if (maxWidthOrHeight && (width > maxWidthOrHeight || height > maxWidthOrHeight)) {
				const options = {
				maxWidthOrHeight: maxWidthOrHeight,
				useWebWorker: true,
				fileType: `image/${file.extension}` as any
				};

			processedFile = await imageCompression(imageFile, options);
			new Notice(`Resized ${file.name} before upload`);
			}

			const formData = new FormData();
			formData.append('image', processedFile, file.name);

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
			} else if (result.status === 403) {
				new Notice(`Failed to upload image ${file.name}: Invalid API key`);
				console.error(`Image upload failed with 403 for ${file.name}`);
			} else {
				new Notice(`Failed to upload image ${file.name}: HTTP ${result.status}`);
				console.error(`Image upload failed for ${file.name}:`, result.status, await result.text());
			}
		} catch (e) {
			new Notice(`Error uploading image ${file.name}. Check console for details.`);
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
				if (view.file) {
					this.saveDraft(view.file.basename, editor.getValue())
				}
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

		new Setting(containerEl)  
   		 	.setName('Resize by')  
    		.addDropdown((dropdown) => dropdown  
          		.addOption('longest', 'Longest Side')  
          		.addOption('height', 'Height')  
          		.addOption('width', 'Width')  
          		.setValue(this.plugin.settings.sidePreference)  
          		.onChange(async (value) => {  
             		this.plugin.settings.sidePreference = value as sidePreference;  
             		await this.plugin.saveSettings();  
          		})
			);  

		new Setting(containerEl)  
    		.setName('Max size')  
    		.setDesc('Buttondown recommendens images to be 1200 by 1200 px')  
    		.addText((text) => text  
          		.setPlaceholder('1200')  
          		.setValue(String(this.plugin.settings.resizeLimit))  
          		.onChange(async (value) => {  
					const numValue = parseInt(value);
    				if (!isNaN(numValue) && numValue > 0) {
        				this.plugin.settings.resizeLimit = numValue;
        				await this.plugin.saveSettings();
    				} else {
        				new Notice('Please enter a whole positive number');
    				}
          })
    	);	
	}
}

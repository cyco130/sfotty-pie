/**
 * The app's user-facing text, in one place so it can become a per-language
 * translation table later. Two catalogs live here:
 *
 * - `messages`: prose and labels - alerts, status text, panel titles, button
 *   labels, placeholders, and help/About copy. Parameterized messages are
 *   functions; everything else is a plain string.
 * - `labels`: the command catalog (keyed by command label key; see commands.ts).
 *
 * Deliberately NOT collected here: keyboard key-caps and symbols (e.g. the
 * on-screen keyboard), the OSD's Atari-key buttons (Option/Select/Start/Reset/
 * Fire), and hardware tokens (800/XL/130XE, NTSC/PAL, the "D1:" device name).
 * Those are nomenclature or glyphs, not translatable copy, and stay inline.
 */

/** Human-readable duration: `"42s"` under a minute, else `"4m 12s"`. */
function formatDuration(seconds: number): string {
	if (seconds < 60) return `${Math.round(seconds)}s`;
	return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export const messages = {
	app: {
		loadingFirmware: "Loading firmware…",
	},

	pages: {
		home: {
			title: "Sfotty Pie",
			// Kept short for the meta description / social-card unfurl (the lead
			// is too long); see head.ts.
			description:
				"A cycle-exact 6502 toolkit: run the Atari 8-bit in your browser, plus a 6502 core and assembler.",
			heading: "Sfotty Pie",
			lead: "Sfotty Pie is a set of tools for the 6502 (Sixty-Five-Oh-Two), the 8-bit CPU behind the Atari 8-bit, Apple II, Commodore 64, NES, and many others. It spans a cycle-exact 6502 core, an Atari 8-bit machine, and a 6502 assembler.",
			launch: "Atari 8-bit emulator",
			github: "GitHub",
			legal:
				"Sfotty Pie is MIT-licensed and is not affiliated with Atari. Bundled replacement firmware images (AltirraOS, Altirra BASIC, Atari++) are used under their own licenses.",
			thirdPartyLicenses: "Third-party licenses",
		},
		emu: {
			title: "A8 Web - Sfotty Pie",
		},
		atari: {
			title: "Atari 8-bit - Sfotty Pie",
			heading: "Atari 8-bit",
			emu: "Emulator",
			docs: "Docs",
			docsDesc: "Getting started and how-to guides.",
			reference: "Reference",
			referenceDesc: "Keyboard, ATASCII, and character tables.",
		},
		reference: {
			title: "Reference - Sfotty Pie",
			heading: "Atari 8-bit reference",
			atasciiKeyboard: "ATASCII & keyboard",
		},
		atasciiKeyboard: {
			title: "ATASCII & keyboard - Sfotty Pie",
		},
		labs: {
			title: "Labs - Sfotty Pie",
			heading: "Labs",
			keyboard: "Keyboard event lab",
		},
		keyboard: {
			title: "Keyboard event lab - Sfotty Pie",
		},
		notFound: {
			title: "Not found - Sfotty Pie",
			heading: "Page not found",
			body: "That page doesn’t exist.",
			home: "Go home",
		},
	},

	audio: {
		unavailable: "No audio",
		suspended: "Tap for audio",
		on: "Audio on",
		muted: "Audio muted",
	},

	topBar: {
		menu: "Menu",
		running: "Running",
		paused: "Paused",
		turbo: "Turbo mode",
	},

	bottomBar: {
		cartridge: "Cart:",
		crashed: "CPU crashed (CIM)",
		keyboardDetached: "Keyboard detached",
		attachKeyboard: "Click to attach the keyboard",
	},

	sidebar: {
		close: "Close",
		model: "Model",
		ram: "RAM",
		separateAntic: "Separate ANTIC access",
		tv: "TV",
		videoChip: "Video chip",
		basic: "BASIC",
		on: "On",
		off: "Off",
		rebootToApply: "Reboot to apply",
		keys: "Keys",
		about: "About",
		aboutBlurb: "Sfotty Pie A8 Web - an Atari 8-bit emulator. MIT-licensed.",
		sourceOnGitHub: "Source on GitHub",
		firmwareNotice:
			"Bundled firmware (AltirraOS, Altirra BASIC, Atari++) is used under its own license.",
		thirdPartyLicenses: "Third-party licenses",
		build: "Build",
		titleMenu: "Sfotty Pie A8 Web",
		titleSettings: "Settings",
		titlePalette: "Commands",
		titleKeys: "Shortcuts",
	},

	// The OSD's paste view: free-form text typed into the machine on send.
	paste: {
		placeholder: "Type or paste text to send to the Atari…",
		send: "Type it in",
		chMode: "Inject into CH (764) instead of the K: handler",
	},

	// The controllers panel: a live view of connected gamepads for diagnosis and
	// (later) binding. Button/axis names are hardware tokens and stay inline; only
	// the surrounding copy is here.
	controllers: {
		noPad: "Connect a controller and press a button to see it here.",
		standard: "Standard mapping",
		nonStandard: "Non-standard mapping",
		joystick: "Joystick",
		off: "Off",
		buttons: "Buttons",
		axes: "Axes",
		bindings: "Bindings",
		joystickSection: "Joystick",
		consoleSection: "Console",
		addBinding: "Add binding",
		reset: "Reset to defaults",
		pressInput: "Press a button or push a stick…  (Esc to cancel)",
		remap: "Remap…",
		remapped: "Remapped",
		removeMapping: "Remove mapping",
		nowActive: "Now active:",
		nothingActive: "nothing",
		mappingDefault: "Default",
		mappingDefaultDetail: (detail: string) => `Default (${detail})`,
		mappingNone: "None",
		mappingHat: "Hat",
		buttonNumber: (n: number) => `Button #${n}`,
		axisNumber: (n: number) => `Axis #${n}`,
		invertedAxis: "Inverted",
		hatMapping: (axis: number) => `D-pad ← hat on axis #${axis}`,
		capture: "Capture",
		releaseFirst: "Release everything…",
		pressTarget: "Press or push it…  (Esc to cancel)",
		pushPositive: "Push its right / down side…  (Esc to cancel)",
		saveMapping: "Save mapping",
		cancel: "Cancel",
		role: {
			up: "Up",
			down: "Down",
			left: "Left",
			right: "Right",
			trigger: "Trigger",
		},
	},

	// The main menu is a launcher, so its entries read as short destinations -
	// not the palette's "Category: verb" phrasing (though they run the same
	// commands). Order (after `docs`) matches MENU_COMMANDS in sidebar.tsx;
	// `docs` is a standalone link to the docs subapp, not a command.
	menu: {
		docs: "Help & docs",
		settings: "Settings…",
		devices: "Devices…",
		boot: "Boot image…",
		library: "Library…",
		palette: "Command palette…",
	},

	// The consolidated settings view: one panel, tabbed.
	settings: {
		hardware: "Hardware",
		roms: "ROMs",
		display: "Display",
		shortcuts: "Shortcuts",
		controllers: "Controllers",
	},

	// The devices view: a standalone tabbed panel of what's plugged into the
	// machine. Tab labels are the CIO device letters (hardware tokens, kept
	// inline in the frame); these spell them out. Rates and drive names on
	// the D: tab are hardware tokens too and stay inline.
	devices: {
		title: "Devices",
		diskDrives: "Disk drives",
		keyboard: "Keyboard",
		trapSiov: "Trap SIOV calls",
		accelerateSio: "Accelerate serial I/O",
		sioSpeed: "SIO speed",
		sioSpeedStandard: "standard",
		sioSpeedMax: "max",
		divisorValue: (n: number): string => `divisor ${n}`,
	},

	shortcuts: {
		placeholder: "Search by action or key…",
		noMatches: "No matches",
		back: "Shortcuts",
		bindings: "Bindings",
		noBindings: "No bindings yet",
		addBinding: "Add binding",
		key: "Key",
		keyNone: "Select a key…",
		combo: "Combo",
		none: "None",
		primary: "Primary",
		makePrimary: "Make primary",
		layoutWarning:
			"Key labels assume a US layout - this browser doesn't expose your keyboard layout, so they may not match your keys.",
		setupLayout: "Set up your keyboard",
		keyboardTitle: "Keyboard settings",
		mode: "Typing mode",
		modeCharacter: "Character",
		modePositional: "Positional",
		modeHint:
			"Character types what you mean, layout-aware; Positional maps physical keys raw.",
		pasteMode: "Paste mode",
		pasteModeK: "K: handler",
		pasteModeCh: "CH (764)",
		pasteModeHint:
			"K: feeds the OS keyboard handler; CH injects key codes straight into location 764 for programs that poll it.",
		detachKeyboard: "Detach keyboard",
		keyboardIsDetached: "Keyboard is detached",
		keyboardPlugHint:
			"Detached, keystrokes no longer reach the machine - and an XEGS senses the absence and boots to its built-in game.",
		realisticScan: "Realistic key scan",
		layoutIntro:
			"Pick your keyboard layout so shortcut labels match your keys. Auto-detect uses the browser's reported layout when available.",
		layoutAuto: "Auto-detect (from browser)",
		layoutAutoUnavailable: "unavailable",
		layoutRegenerates:
			"Changing this regenerates the default shortcuts, discarding customizations.",
		confirmLayout:
			"Change keyboard layout? This regenerates the default shortcuts, discarding your customizations.",
		// Display names for the layout picker. Several labels can share one built-in
		// map (Finnish uses the Swedish map, Catalan the Spanish, Austrian the
		// German, Slovenian the Croatian; Dutch and Polish are US QWERTY at the
		// base layer). These are language names - translatable copy, not hardware
		// tokens - so unlike the machine/RAM names they live here.
		layoutNames: {
			us: "English (US)",
			uk: "English (UK)",
			nl: "Dutch",
			pl: "Polish",
			es: "Spanish",
			ca: "Catalan",
			es419: "Spanish (Latin America)",
			it: "Italian",
			pt: "Portuguese (Portugal)",
			br: "Portuguese (Brazil)",
			fr: "French (AZERTY)",
			be: "Belgian (AZERTY)",
			de: "German",
			at: "Austrian",
			chDe: "Swiss German",
			chFr: "Swiss French",
			se: "Swedish",
			fi: "Finnish",
			no: "Norwegian",
			dk: "Danish",
			ee: "Estonian",
			lv: "Latvian",
			lt: "Lithuanian",
			cz: "Czech",
			sk: "Slovak",
			hu: "Hungarian",
			hr: "Croatian",
			sl: "Slovenian",
			ro: "Romanian",
			trQ: "Turkish (Q)",
			trF: "Turkish (F)",
		},
		capture: "Capture combo…",
		capturePrompt: "Press a key combo…",
		captureHint: "Enter to set · Esc to cancel",
		scope: "Scope",
		scopeMachine: "Emulator",
		scopeGlobal: "Global",
		modOff: "Off",
		modOn: "On",
		modAny: "Any",
		add: "Add",
		removeBinding: "Remove binding",
		confirmRemove: (chord: string) => `Remove the ${chord} binding?`,
		confirmReset:
			"Reset all key bindings to defaults? Your customizations will be lost.",
		unknownCommand: "Unknown command",
		warnTyping: "Types in Character mode - only fires in Positional.",
		warnConflict: (label: string) =>
			`Currently "${label}" - adding will reassign it.`,
	},

	roms: {
		osRoms: "OS ROMs",
		cartRoms: "Built-in cartridge ROMs",
		inUse: "in use",
		unsaved: "Unsaved change",
		save: "Save changes",
		noSuitable: "No suitable ROMs",
		manageLibrary: "Manage library",
	},

	recents: {
		title: "Recents",
		keepTitle: "Add to library",
		remove: "Remove from recents",
		kept: (name: string): string => `Added ${name} to the library`,
		favorite: "Add to favorites",
		unfavorite: "Remove from favorites",
	},

	favorites: {
		title: "Favorites",
		recentsTitle: "Recent",
		empty:
			"No favorites yet - star games in the menu's Recents list or in the library.",
		hint: "🕹 select · A / ✕ boot · B / ○ back",
	},

	library: {
		title: "Library",
		drop: "Drop files or folders here, or",
		importTags: "Tag imported files (comma-separated)…",
		browse: "browse files",
		browseFolder: "a folder",
		empty: "No images yet.",
		noMatches: "No images match your filters.",
		loading: "Loading…",
		notFound: "Image not found.",
		hash: "Hash",
		copyHash: "click to copy",
		deleted: (name: string): string => `Removed ${name}`,
		confirmDelete: (name: string): string =>
			`Delete ${name}? This can't be undone.`,
		clear: "Clear library",
		confirmClear:
			"Clear the entire library? This removes all uploads and can't be undone.",
		cleared: "Library cleared",
		exportLibrary: "Export",
		importLibrary: "Import",
		exporting: "Exporting…",
		compressing: "Compressing…",
		exportFailed: "Library export failed.",
		actions: {
			boot: "Boot",
			attachDisk: "Attach to D1:",
			attachCart: "Attach cartridge",
			download: "Download",
			delete: "Delete",
		},
		preparing: "Preparing…",
		adding: "Adding…",
		eta: (seconds: number): string => `~${formatDuration(seconds)} left`,
		search: "Filter by name…",
		allTypes: "All types",
		allSources: "All sources",
		allTags: "All tags",
		sourceBuiltin: "Built-in",
		sourceUser: "Yours",
		prev: "Prev",
		next: "Next",
		// Field labels - filter selects, the item detail view, and table heads.
		columns: {
			name: "Name",
			type: "Type",
			size: "Size",
			source: "Source",
		},
		// Extra table head for a type-filtered disk view - sectors×bytes-per-sector.
		// `sectors`/`bps` label the dismissable filter chips for each part.
		detail: {
			geometry: "Geometry",
			sectors: "sectors",
			bps: "BPS",
		},
		removeFilter: "Remove filter",
		// Per-type fact rows in the item detail view.
		fields: {
			name: "Name",
			cartType: "Cartridge type",
			osType: "OS type",
			sectors: "Sectors",
			sectorSize: "Sector size",
		},
		// The cartridge-type picker on unknown ROMs / cart entries.
		cartTypeUnknown:
			"The cartridge type of this ROM couldn't be detected. Pick one to boot it - if it doesn't run, come back and try another.",
		cartTypeUnknownToast: (name: string) =>
			`${name}: Pick a cartridge type first`,
		pickCartType: "Pick a cartridge type…",
		suggestedSuffix: " (suggested)",
		notEmulatedSuffix: " - not emulated yet",
		is5200Suffix: " - Atari 5200",
		// The slot flags an 8K cart can be tagged with (the BASIC / built-in-game
		// ROM slots). "BASIC" is a hardware token; the rest is translatable.
		slots: {
			title: "Firmware slots",
			basic: "BASIC",
			game: "Built-in game",
		},
		save: "Save",
		renamed: (name: string): string => `Renamed to ${name}`,
		tags: {
			label: "Tags",
			add: "Add a tag…",
			remove: "Remove tag",
		},
		// Heading for the item view's recognized-image section (firmware today;
		// DOSes and other known software later).
		knownTitle: "Well-known image",
		typeName: {
			os: "OS",
			cart: "Cartridge",
			disk: "Disk",
			xex: "Executable",
			"unknown-rom": "Unknown ROM",
		},
		range: (from: number, to: number, total: number): string =>
			`${from}-${to} of ${total}`,
		uploaded: (
			added: number,
			deduped: number,
			failed: number,
			seconds: number,
		): string => {
			const parts: string[] = [];
			if (added > 0) {
				parts.push(added === 1 ? "Added 1 image" : `Added ${added} images`);
			}
			if (deduped > 0) parts.push(`${deduped} already in the library`);
			if (failed > 0) {
				parts.push(
					failed === 1 ? "1 not recognized" : `${failed} not recognized`,
				);
			}
			const summary =
				parts.length > 0 ? `${parts.join(". ")}.` : "Nothing to add.";
			return `${summary} (${formatDuration(seconds)})`;
		},
	},

	reset: {
		confirmEverything:
			"Wipe the entire library AND all saved settings? This can't be undone.",
		confirmDefaults:
			"Reset all settings to defaults? Saved settings and key bindings will be lost.",
		everything: "Reset everything - library and settings",
		tab: "This tab reset to your saved settings",
		defaults: "All settings reset to defaults",
	},

	keyHelp: {
		arrowKeys: "Arrow keys",
		joystick: "Joystick",
		trigger: "Trigger",
		coldReset: "Cold reset",
	},

	// Keyboard key and modifier labels. macOS uses glyphs (⌘⇧…, ⌫, ↑) kept inline -
	// they're symbols, not translatable copy - and so does "fn". Windows spells
	// keys with the short, localizable words below; bare modifier keys spell their
	// name in full on macOS (Control/Option/Command) but short on Windows.
	keys: {
		// Chord-modifier words (Windows prefixes). macOS uses ⌃⇧⌥⌘ inline.
		mod: { ctrl: "Ctrl", shift: "Shift", alt: "Alt", win: "Win" },
		// macOS full forms for bare modifier keys (Shift is the same short/full).
		modFull: { control: "Control", option: "Option", command: "Command" },
		side: { left: "Left", right: "Right" },
		// Named keys - Windows short forms (macOS uses glyphs / fn-combos).
		backspace: "BkSp",
		enter: "Enter",
		tab: "Tab",
		capsLock: "Caps Lock",
		esc: "Esc",
		space: "Space",
		home: "Home",
		end: "End",
		pageUp: "PgUp",
		pageDown: "PgDn",
		insert: "Ins",
		delete: "Del",
		pause: "Pause",
	},

	palette: {
		placeholder: "Type a command…",
		noCommands: "No commands",
	},

	// The display settings panel. NTSC/PAL and PF0-PF3 are hardware tokens
	// (inline); preset names are descriptive copy, so they live here.
	display: {
		overscan: "Overscan",
		width: "Width",
		height: "Height",
		palette: "Palette",
		tint: "Tint (hue 1)",
		hueStep: "Hue step (pot)",
		saturation: "Saturation",
		brightness: "Brightness",
		contrast: "Contrast",
		gamma: "Gamma",
		primaries: "Primaries",
		// Decode-primaries options: which phosphor set the decoded signal is
		// interpreted against. Standard names are hardware-ish tokens but the
		// "none" phrasing is copy, so the labels live here.
		primariesNames: {
			srgb: "None",
			ntsc1953: "NTSC 1953",
			smpteC: "SMPTE C",
			ebu: "EBU",
		} as Record<string, string>,
		frameBlendingTitle: "Frame blending",
		frameBlending: "Amount",
		reset: "Reset to defaults",
		// Wide gamut is automatic (no setting); this line just reports it.
		wideGamutActive: "Output: Display P3 (wide gamut)",
		wideGamutOff: "Output: sRGB",
		notRunning:
			"The machine is on the other standard - these settings preview in the guide below only.",
		overscanPresets: {
			full: "Full",
			normal: "Normal",
			none: "No overscan",
		} as Record<string, string>,
		palettePresets: {
			vintage: "Vintage",
			modern: "Modern",
			hues15: "15 hues",
			calibrated: "Calibrated",
			blueGr0: "Blue GR. 0",
		} as Record<string, string>,
		guideGrays: "Grays 0-15",
		guideHues: "Hues 1-15 · luma 8",
		guideOs: "OS defaults PF0-PF3",
		guideWrap: "Hue 1 vs hue 15 · luma 8",
	},

	osd: {
		joystickControls: "Joystick controls",
		keyboard: "Keyboard",
		pasteText: "Paste text",
		hideControls: "Hide controls",
		swapSides: "Swap stick and fire sides",
	},

	errors: {
		osRom: "That looks like an OS ROM, not something loadable.",
		unrecognized: "Unrecognized file format.",
		cartTypeUnsupported: "This cartridge type isn't emulated yet.",
		cart5200: "Atari 5200 cartridges can't run on this machine.",
		audioUnavailable: "Audio is unavailable in this browser.",
		audioUnavailableReason: (reason: string) => `Audio unavailable: ${reason}`,
		clipboardUnavailable:
			"Couldn't read the clipboard (denied or unsupported).",
		nothingToPaste: "Nothing pasteable in the clipboard.",
		pasteUnsupported: "Paste needs a recognized OS ROM.",
		noWritableDisk: "No writable disk in D1: to download.",
		noDiskToSave: "No disk in D1: to save.",
		notLibraryDisk: "Only a disk attached from the library can be saved.",
		noDiskToDetach: "No disk in D1: to detach.",
		notACartridge: "Not a cartridge image.",
		noCartridge: "No cartridge to detach.",
		fullscreenUnavailable: "Full screen isn't available in this browser.",
		noCompatibleOs: (model: string, tv: string) =>
			`No compatible OS ROM in the library for ${model} (${tv}).`,
	},

	// Announcements (info/warning toasts) for state changes that would
	// otherwise be silent - especially palette commands. Present tense.
	toasts: {
		controllerConnected: (name: string, port: number | null) =>
			port === null
				? `Controller connected: ${name}`
				: `Controller connected: ${name} → Joystick ${port}`,
		controllerDisconnected: (name: string) =>
			`Controller disconnected: ${name}`,
		bootDisk: (name: string) => `Booting D1: (${name})`,
		bootCartridge: (name: string) => `Booting cartridge (${name})`,
		bootExecutable: (name: string) => `Booting executable (${name})`,
		attachingDisk: (name: string) => `Attaching D1: (${name})`,
		detachingDisk: (name: string) => `Detaching D1: (${name})`,
		attachingCartridge: (name: string) => `Attaching cartridge (${name})`,
		detachingCartridge: (name: string) => `Detaching cartridge (${name})`,
		enablingBasic: "Enabling BASIC",
		disablingBasic: "Disabling BASIC",
		switchingMachine: (model: string) => `Switching to Atari ${model}`,
		switchingTv: (tv: string) => `Switching TV to ${tv}`,
		switchingVideoChip: (chip: string) => `Switching video chip to ${chip}`,
		powerCycling: "Rebooting",
		keyboardMode: (mode: "character" | "positional"): string =>
			`Keyboard: ${mode === "positional" ? "Positional" : "Character"} mode`,
		realisticScan: (enabled: boolean): string =>
			`Keyboard: Realistic key scan ${enabled ? "on" : "off"}`,
		keyboardAttached: (attached: boolean): string =>
			attached ? "Keyboard attached" : "Keyboard detached",
		keyBindingsReset: "Key bindings reset to defaults",
		pasted: (count: number): string =>
			`Pasting ${count} character${count === 1 ? "" : "s"}`,
		pasteMode: (ch: boolean): string =>
			`Paste mode: ${ch ? "CH (764) injection" : "K: handler"}`,
		sioTrap: (enabled: boolean): string =>
			`Serial I/O: SIOV trap ${enabled ? "on" : "off"}`,
		sioAcceleration: (enabled: boolean): string =>
			`Serial I/O: acceleration ${enabled ? "on" : "off"}`,
		diskSpeed: (index: number | undefined): string =>
			index === undefined
				? "Disk SIO speed: standard"
				: `Disk SIO speed: divisor ${index}`,
		saving: (name: string) => `Saving (${name})`,
		cartTypeSet: (typeName: string) => `Cartridge type set: ${typeName}`,
		savedToLibrary: (name: string) => `Saved (${name}) to the library`,
		copy: "Copy",
		copied: "Copied",
		dismiss: "Dismiss",
	},
} as const;

/**
 * The flat label catalog. Today it is the English strings; it is shaped to
 * become a per-language translation table later (commands reference these keys,
 * not the strings). No interpolation yet - add it if/when a label needs it.
 */
export const labels = {
	POWER_CYCLE: "Atari: Reboot (cold reset)",
	PAUSE: "Emulation: Pause",
	RESUME: "Emulation: Resume",
	TOGGLE_PAUSE: "Emulation: Pause or resume",
	TURBO_MODE_ENABLE: "Emulation: Enable turbo mode (unthrottled, muted)",
	TURBO_MODE_DISABLE: "Emulation: Disable turbo mode",
	TURBO_MODE_TOGGLE: "Emulation: Toggle turbo mode",
	TURBO_HOLD: "Emulation: Turbo mode while held",
	KEYBOARD_MODE_CHARACTER:
		"Keyboard: Switch to character mode (layout-aware typing)",
	KEYBOARD_MODE_POSITIONAL:
		"Keyboard: Switch to positional mode (raw, by physical key)",
	KEYBOARD_MODE_TOGGLE: "Keyboard: Toggle character / positional mode",
	KEYBOARD_REALISTIC_SCAN_ENABLE:
		"Keyboard: Enable realistic key scan (keys can jam, like the hardware)",
	KEYBOARD_REALISTIC_SCAN_DISABLE:
		"Keyboard: Disable realistic key scan (new presses lift held keys)",
	KEYBOARD_REALISTIC_SCAN_TOGGLE: "Keyboard: Toggle realistic key scan",
	KEYBOARD_ATTACH: "Keyboard: Attach",
	KEYBOARD_DETACH: "Keyboard: Detach (an XEGS senses the absence)",
	SIO_TRAP_TOGGLE: "Serial I/O: Toggle the SIOV trap (instant OS disk calls)",
	SIO_ACCELERATION_TOGGLE: "Serial I/O: Toggle acceleration",
	KEY_BINDINGS_RESET: "Keyboard: Reset key bindings to defaults",
	PASTE_TEXT: "Keyboard: Paste text from the clipboard",
	PASTE_MODE_TOGGLE: "Keyboard: Toggle paste mode (K: handler / CH injection)",
	AUDIO_MUTE: "Audio: Mute",
	AUDIO_UNMUTE: "Audio: Unmute",
	AUDIO_TOGGLE: "Audio: Toggle",
	OPEN_MENU: "View: Open menu…",
	OPEN_CONFIG: "Settings: Hardware…",
	OPEN_SETTINGS: "Settings: Open…",
	OPEN_DISPLAY: "Settings: Display…",
	OPEN_PALETTE: "View: Open command palette…",
	OPEN_KEYS: "Settings: Keyboard shortcuts…",
	OPEN_CONTROLLERS: "Settings: Controllers…",
	CLOSE_PANEL: "View: Close panel",
	OPEN_ROMS: "Settings: ROM preferences…",
	OPEN_DEVICES: "Devices: Open…",
	OPEN_LIBRARY: "Library: Open…",
	OPEN_FAVORITES: "Library: Open game picker…",
	CLEAR_LIBRARY: "Library: Clear…",
	NUKE_EVERYTHING: "Settings: Reset everything (library and settings)…",
	RESET_TAB_SETTINGS: "Settings: Reset this tab to saved settings",
	RESET_DEFAULT_SETTINGS: "Settings: Reset all settings to defaults",
	TOGGLE_FULLSCREEN: "View: Toggle full screen",
	OSD_TOGGLE: "View: Toggle on-screen controls",
	BOOT_IMAGE: "Media: Boot a disk, cartridge, or executable…",
	ATTACH_D1: "Media: Attach a disk to D1:…",
	DETACH_D1: "Media: Detach the disk from D1:",
	ATTACH_CARTRIDGE: "Media: Attach a cartridge… [reboots]",
	DETACH_CARTRIDGE: "Media: Detach the cartridge [reboots]",
	DOWNLOAD_D1: "Media: Download the D1: disk image…",
	SAVE_D1_TO_LIBRARY: "Library: Save D1: to library",
	SET_MODEL_400_800: "Machine: Set model to Atari 400/800 [reboots]",
	SET_MODEL_1200XL: "Machine: Set model to Atari 1200XL [reboots]",
	SET_MODEL_XLXE: "Machine: Set model to Atari XL/XE [reboots]",
	SET_MODEL_XEGS: "Machine: Set model to Atari XEGS [reboots]",
	SET_TV_NTSC: "Machine: Set TV standard to NTSC [reboots]",
	SET_TV_PAL: "Machine: Set TV standard to PAL [reboots]",
	SET_TV_TOGGLE: "Machine: Toggle TV standard (NTSC/PAL) [reboots]",
	BASIC_ENABLE: "Machine: Enable BASIC [reboots]",
	BASIC_DISABLE: "Machine: Disable BASIC [reboots]",
	BASIC_TOGGLE: "Machine: Toggle BASIC [reboots]",
	PRESS_L: "Atari: Press L ($00)",
	PRESS_J: "Atari: Press J ($01)",
	PRESS_SEMICOLON: "Atari: Press Semicolon (';', $02)",
	PRESS_F1: "Atari: Press F1 (Cursor Up, $03)",
	PRESS_F2: "Atari: Press F2 (Cursor Down, $04)",
	PRESS_K: "Atari: Press K ($05)",
	PRESS_PLUS: "Atari: Press Plus ('+', $06)",
	PRESS_ASTERISK: "Atari: Press Asterisk ('*', $07)",
	PRESS_O: "Atari: Press O ($08)",
	PRESS_CODE_09: "Atari: Press key $09 ($09)",
	PRESS_P: "Atari: Press P ($0A)",
	PRESS_U: "Atari: Press U ($0B)",
	PRESS_RETURN: "Atari: Press Return ($0C)",
	PRESS_I: "Atari: Press I ($0D)",
	PRESS_MINUS: "Atari: Press Minus ('-', $0E)",
	PRESS_EQUALS: "Atari: Press Equals ('=', $0F)",
	PRESS_V: "Atari: Press V ($10)",
	PRESS_HELP: "Atari: Press Help ($11)",
	PRESS_C: "Atari: Press C ($12)",
	PRESS_F3: "Atari: Press F3 (Cursor Left, $13)",
	PRESS_F4: "Atari: Press F4 (Cursor Right, $14)",
	PRESS_B: "Atari: Press B ($15)",
	PRESS_X: "Atari: Press X ($16)",
	PRESS_Z: "Atari: Press Z ($17)",
	PRESS_4: "Atari: Press 4 ($18)",
	PRESS_CODE_19: "Atari: Press key $19 ($19)",
	PRESS_3: "Atari: Press 3 ($1A)",
	PRESS_6: "Atari: Press 6 ($1B)",
	PRESS_ESC: "Atari: Press Esc ($1C)",
	PRESS_5: "Atari: Press 5 ($1D)",
	PRESS_2: "Atari: Press 2 ($1E)",
	PRESS_1: "Atari: Press 1 ($1F)",
	PRESS_COMMA: "Atari: Press Comma (',', $20)",
	PRESS_SPACE: "Atari: Press Space ($21)",
	PRESS_PERIOD: "Atari: Press Period ('.', $22)",
	PRESS_N: "Atari: Press N ($23)",
	PRESS_CODE_24: "Atari: Press key $24 ($24)",
	PRESS_M: "Atari: Press M ($25)",
	PRESS_SLASH: "Atari: Press Slash ('/', $26)",
	PRESS_INVERSE_VIDEO: "Atari: Press Inverse Video ($27)",
	PRESS_R: "Atari: Press R ($28)",
	PRESS_CODE_29: "Atari: Press key $29 ($29)",
	PRESS_E: "Atari: Press E ($2A)",
	PRESS_Y: "Atari: Press Y ($2B)",
	PRESS_TAB: "Atari: Press Tab ($2C)",
	PRESS_T: "Atari: Press T ($2D)",
	PRESS_W: "Atari: Press W ($2E)",
	PRESS_Q: "Atari: Press Q ($2F)",
	PRESS_9: "Atari: Press 9 ($30)",
	PRESS_CODE_31: "Atari: Press key $31 ($31)",
	PRESS_0: "Atari: Press 0 ($32)",
	PRESS_7: "Atari: Press 7 ($33)",
	PRESS_BACKSPACE: "Atari: Press Backspace ($34)",
	PRESS_8: "Atari: Press 8 ($35)",
	PRESS_LESS_THAN: "Atari: Press Less Than ('<', $36)",
	PRESS_GREATER_THAN: "Atari: Press Greater Than ('>', $37)",
	PRESS_F: "Atari: Press F ($38)",
	PRESS_H: "Atari: Press H ($39)",
	PRESS_D: "Atari: Press D ($3A)",
	PRESS_CODE_3B: "Atari: Press key $3B ($3B)",
	PRESS_CAPS: "Atari: Press Caps ($3C)",
	PRESS_G: "Atari: Press G ($3D)",
	PRESS_S: "Atari: Press S ($3E)",
	PRESS_A: "Atari: Press A ($3F)",
	PRESS_SHIFT_L: "Atari: Press Shift+L ($40)",
	PRESS_SHIFT_J: "Atari: Press Shift+J ($41)",
	PRESS_SHIFT_SEMICOLON: "Atari: Press Shift+Semicolon (Colon, ':', $42)",
	PRESS_SHIFT_F1: "Atari: Press Shift+F1 (Cursor to Upper Left Corner, $43)",
	PRESS_SHIFT_F2: "Atari: Press Shift+F2 (Cursor to Lower Left Corner, $44)",
	PRESS_SHIFT_K: "Atari: Press Shift+K ($45)",
	PRESS_SHIFT_PLUS: "Atari: Press Shift+Plus (Backslash, '\\', $46)",
	PRESS_SHIFT_ASTERISK: "Atari: Press Shift+Asterisk (Circumflex, '^', $47)",
	PRESS_SHIFT_O: "Atari: Press Shift+O ($48)",
	PRESS_SHIFT_CODE_09: "Atari: Press key $49 ($49)",
	PRESS_SHIFT_P: "Atari: Press Shift+P ($4A)",
	PRESS_SHIFT_U: "Atari: Press Shift+U ($4B)",
	PRESS_SHIFT_RETURN: "Atari: Press Shift+Return ($4C)",
	PRESS_SHIFT_I: "Atari: Press Shift+I ($4D)",
	PRESS_SHIFT_MINUS: "Atari: Press Shift+Minus (Underscore, '_', $4E)",
	PRESS_SHIFT_EQUALS: "Atari: Press Shift+Equals (Vertical Line, '|', $4F)",
	PRESS_SHIFT_V: "Atari: Press Shift+V ($50)",
	PRESS_SHIFT_HELP: "Atari: Press Shift+Help ($51)",
	PRESS_SHIFT_C: "Atari: Press Shift+C ($52)",
	PRESS_SHIFT_F3: "Atari: Press Shift+F3 (Cursor to Beginning of Line, $53)",
	PRESS_SHIFT_F4: "Atari: Press Shift+F4 (Cursor to End of Line, $54)",
	PRESS_SHIFT_B: "Atari: Press Shift+B ($55)",
	PRESS_SHIFT_X: "Atari: Press Shift+X ($56)",
	PRESS_SHIFT_Z: "Atari: Press Shift+Z ($57)",
	PRESS_SHIFT_4: "Atari: Press Shift+4 (Dollar Sign, '$', $58)",
	PRESS_SHIFT_CODE_19: "Atari: Press key $59 ($59)",
	PRESS_SHIFT_3: "Atari: Press Shift+3 (Number Sign, '#', $5A)",
	PRESS_SHIFT_6: "Atari: Press Shift+6 (Ampersand, '&', $5B)",
	PRESS_SHIFT_ESC: "Atari: Press Shift+Esc ($5C)",
	PRESS_SHIFT_5: "Atari: Press Shift+5 (Percent Sign, '%', $5D)",
	PRESS_SHIFT_2: "Atari: Press Shift+2 (Quotation Mark, '\"', $5E)",
	PRESS_SHIFT_1: "Atari: Press Shift+1 (Exclamation Mark, '!', $5F)",
	PRESS_SHIFT_COMMA: "Atari: Press Shift+Comma (Left Square Bracket, '[', $60)",
	PRESS_SHIFT_SPACE: "Atari: Press Shift+Space ($61)",
	PRESS_SHIFT_PERIOD:
		"Atari: Press Shift+Period (Right Square Bracket, ']', $62)",
	PRESS_SHIFT_N: "Atari: Press Shift+N ($63)",
	PRESS_SHIFT_CODE_24: "Atari: Press key $64 ($64)",
	PRESS_SHIFT_M: "Atari: Press Shift+M ($65)",
	PRESS_SHIFT_SLASH: "Atari: Press Shift+Slash (Question Mark, '?', $66)",
	PRESS_SHIFT_INVERSE_VIDEO: "Atari: Press Shift+Inverse Video ($67)",
	PRESS_SHIFT_R: "Atari: Press Shift+R ($68)",
	PRESS_SHIFT_CODE_29: "Atari: Press key $69 ($69)",
	PRESS_SHIFT_E: "Atari: Press Shift+E ($6A)",
	PRESS_SHIFT_Y: "Atari: Press Shift+Y ($6B)",
	PRESS_SHIFT_TAB: "Atari: Press Shift+Tab (Set Tab Stop, $6C)",
	PRESS_SHIFT_T: "Atari: Press Shift+T ($6D)",
	PRESS_SHIFT_W: "Atari: Press Shift+W ($6E)",
	PRESS_SHIFT_Q: "Atari: Press Shift+Q ($6F)",
	PRESS_SHIFT_9: "Atari: Press Shift+9 (Left Parenthesis, '(', $70)",
	PRESS_SHIFT_CODE_31: "Atari: Press key $71 ($71)",
	PRESS_SHIFT_0: "Atari: Press Shift+0 (Right Parenthesis, ')', $72)",
	PRESS_SHIFT_7: "Atari: Press Shift+7 (Apostrophe, ''', $73)",
	PRESS_SHIFT_BACKSPACE: "Atari: Press Shift+Backspace (Delete Line, $74)",
	PRESS_SHIFT_8: "Atari: Press Shift+8 (Commercial At, '@', $75)",
	PRESS_SHIFT_LESS_THAN: "Atari: Press Shift+Less Than (Clear Screen, $76)",
	PRESS_SHIFT_GREATER_THAN:
		"Atari: Press Shift+Greater Than (Insert Line, $77)",
	PRESS_SHIFT_F: "Atari: Press Shift+F ($78)",
	PRESS_SHIFT_H: "Atari: Press Shift+H ($79)",
	PRESS_SHIFT_D: "Atari: Press Shift+D ($7A)",
	PRESS_SHIFT_CODE_3B: "Atari: Press key $7B ($7B)",
	PRESS_SHIFT_CAPS: "Atari: Press Shift+Caps ($7C)",
	PRESS_SHIFT_G: "Atari: Press Shift+G ($7D)",
	PRESS_SHIFT_S: "Atari: Press Shift+S ($7E)",
	PRESS_SHIFT_A: "Atari: Press Shift+A ($7F)",
	PRESS_CONTROL_L: "Atari: Press Control+L (Upper Left Quadrant, '▘', $80)",
	PRESS_CONTROL_J: "Atari: Press Control+J (Lower Left Triangle, '◣', $81)",
	PRESS_CONTROL_SEMICOLON: "Atari: Press Control+Semicolon (Spade, '♠', $82)",
	PRESS_CONTROL_F1: "Atari: Press Control+F1 (Keyboard Enable/Disable, $83)",
	PRESS_CONTROL_F2: "Atari: Press Control+F2 (Screen DMA Enable/Disable, $84)",
	PRESS_CONTROL_K: "Atari: Press Control+K (Upper Right Quadrant, '▝', $85)",
	PRESS_CONTROL_PLUS: "Atari: Press Control+Plus (Cursor Left, $86)",
	PRESS_CONTROL_ASTERISK: "Atari: Press Control+Asterisk (Cursor Right, $87)",
	PRESS_CONTROL_O: "Atari: Press Control+O (Lower Left Quadrant, '▖', $88)",
	PRESS_CONTROL_CODE_89: "Atari: Press key $89 ($89)",
	PRESS_CONTROL_P: "Atari: Press Control+P (Club, '♣', $8A)",
	PRESS_CONTROL_U: "Atari: Press Control+U (Lower Half Block, '▄', $8B)",
	PRESS_CONTROL_RETURN: "Atari: Press Control+Return ($8C)",
	PRESS_CONTROL_I: "Atari: Press Control+I (Lower Right Quadrant, '▗', $8D)",
	PRESS_CONTROL_MINUS: "Atari: Press Control+Minus (Cursor Up, $8E)",
	PRESS_CONTROL_EQUALS: "Atari: Press Control+Equals (Cursor Down, $8F)",
	PRESS_CONTROL_V: "Atari: Press Control+V (Left Vertical Bar, '▏', $90)",
	PRESS_CONTROL_HELP: "Atari: Press Control+Help ($91)",
	PRESS_CONTROL_C: "Atari: Press Control+C (Box Up and Left, '┘', $92)",
	PRESS_CONTROL_F3: "Atari: Press Control+F3 (Toggle Key Click, $93)",
	PRESS_CONTROL_F4: "Atari: Press Control+F4 (Toggle Character Set, $94)",
	PRESS_CONTROL_B: "Atari: Press Control+B (Right Vertical Bar, '▕', $95)",
	PRESS_CONTROL_X: "Atari: Press Control+X (Box Up and Horizontal, '┴', $96)",
	PRESS_CONTROL_Z: "Atari: Press Control+Z (Box Up and Right, '└', $97)",
	PRESS_CONTROL_4: "Atari: Press Control+4 ($98)",
	PRESS_CONTROL_CODE_99: "Atari: Press key $99 ($99)",
	PRESS_CONTROL_3: "Atari: Press Control+3 (EOF, $9A)",
	PRESS_CONTROL_6: "Atari: Press Control+6 ($9B)",
	PRESS_CONTROL_ESC: "Atari: Press Control+Esc ($9C)",
	PRESS_CONTROL_5: "Atari: Press Control+5 ($9D)",
	PRESS_CONTROL_2: "Atari: Press Control+2 (Buzzer, $9E)",
	PRESS_CONTROL_1: "Atari: Press Control+1 (Pause/Resume Screen Output, $9F)",
	PRESS_CONTROL_COMMA: "Atari: Press Control+Comma (Heart, '♥', $A0)",
	PRESS_CONTROL_SPACE: "Atari: Press Control+Space ($A1)",
	PRESS_CONTROL_PERIOD: "Atari: Press Control+Period (Diamond, '♦', $A2)",
	PRESS_CONTROL_N: "Atari: Press Control+N (Lower Horizontal Bar, '▁', $A3)",
	PRESS_CONTROL_CODE_A4: "Atari: Press key $A4 ($A4)",
	PRESS_CONTROL_M: "Atari: Press Control+M (Upper Horizontal Bar, '▔', $A5)",
	PRESS_CONTROL_SLASH: "Atari: Press Control+Slash ($A6)",
	PRESS_CONTROL_INVERSE_VIDEO:
		"Press Control+Inverse Video (Control Lock, $A7)",
	PRESS_CONTROL_R: "Atari: Press Control+R (Horizontal Bar, '─', $A8)",
	PRESS_CONTROL_CODE_A9: "Atari: Press key $A9 ($A9)",
	PRESS_CONTROL_E: "Atari: Press Control+E (Box Down and Left, '┐', $AA)",
	PRESS_CONTROL_Y: "Atari: Press Control+Y (Left Half Block, '▌', $AB)",
	PRESS_CONTROL_TAB: "Atari: Press Control+Tab (Clear Tab Stop, $AC)",
	PRESS_CONTROL_T: "Atari: Press Control+T (Bullet, '•', $AD)",
	PRESS_CONTROL_W: "Atari: Press Control+W (Box Down and Horizontal, '┬', $AE)",
	PRESS_CONTROL_Q: "Atari: Press Control+Q (Box Down and Right, '┌', $AF)",
	PRESS_CONTROL_9: "Atari: Press Control+9 ($B0)",
	PRESS_CONTROL_CODE_B1: "Atari: Press key $B1 ($B1)",
	PRESS_CONTROL_0: "Atari: Press Control+0 ($B2)",
	PRESS_CONTROL_7: "Atari: Press Control+7 ($B3)",
	PRESS_CONTROL_BACKSPACE: "Atari: Press Control+Backspace (Delete, $B4)",
	PRESS_CONTROL_8: "Atari: Press Control+8 ($B5)",
	PRESS_CONTROL_LESS_THAN: "Atari: Press Control+Less Than (Clear Screen, $B6)",
	PRESS_CONTROL_GREATER_THAN:
		"Press Control+Greater Than (Insert Character, $B7)",
	PRESS_CONTROL_F:
		"Atari: Press Control+F (Upper Right to Lower Left, '╱', $B8)",
	PRESS_CONTROL_H: "Atari: Press Control+H (Lower Right Triangle, '◢', $B9)",
	PRESS_CONTROL_D: "Atari: Press Control+D (Box Vertical and Left, '┤', $BA)",
	PRESS_CONTROL_CODE_BB: "Atari: Press key $BB ($BB)",
	PRESS_CONTROL_CAPS: "Atari: Press Control+Caps ($BC)",
	PRESS_CONTROL_G:
		"Atari: Press Control+G (Upper Left to Lower Right, '╲', $BD)",
	PRESS_CONTROL_S:
		"Atari: Press Control+S (Box Vertical and Horizontal, '┼', $BE)",
	PRESS_CONTROL_A: "Atari: Press Control+A (Box Vertical and Right, '├', $BF)",
	PRESS_CONTROL_SHIFT_L: "Atari: Press Control+Shift+L ($C0)",
	PRESS_CONTROL_SHIFT_J: "Atari: Press Control+Shift+J ($C1)",
	PRESS_CONTROL_SHIFT_SEMICOLON: "Atari: Press Control+Shift+Semicolon ($C2)",
	PRESS_CONTROL_SHIFT_F1: "Atari: Press Control+Shift+F1 ($C3)",
	PRESS_CONTROL_SHIFT_F2: "Atari: Press Control+Shift+F2 ($C4)",
	PRESS_CONTROL_SHIFT_K: "Atari: Press Control+Shift+K ($C5)",
	PRESS_CONTROL_SHIFT_PLUS: "Atari: Press Control+Shift+Plus ($C6)",
	PRESS_CONTROL_SHIFT_ASTERISK: "Atari: Press Control+Shift+Asterisk ($C7)",
	PRESS_CONTROL_SHIFT_O: "Atari: Press Control+Shift+O ($C8)",
	PRESS_CONTROL_SHIFT_CODE_09: "Atari: Press key $C9 ($C9)",
	PRESS_CONTROL_SHIFT_P: "Atari: Press Control+Shift+P ($CA)",
	PRESS_CONTROL_SHIFT_U: "Atari: Press Control+Shift+U ($CB)",
	PRESS_CONTROL_SHIFT_RETURN: "Atari: Press Control+Shift+Return ($CC)",
	PRESS_CONTROL_SHIFT_I: "Atari: Press Control+Shift+I ($CD)",
	PRESS_CONTROL_SHIFT_MINUS: "Atari: Press Control+Shift+Minus ($CE)",
	PRESS_CONTROL_SHIFT_EQUALS: "Atari: Press Control+Shift+Equals ($CF)",
	PRESS_CONTROL_SHIFT_V: "Atari: Press Control+Shift+V ($D0)",
	PRESS_CONTROL_SHIFT_HELP: "Atari: Press Control+Shift+Help ($D1)",
	PRESS_CONTROL_SHIFT_C: "Atari: Press Control+Shift+C ($D2)",
	PRESS_CONTROL_SHIFT_F3: "Atari: Press Control+Shift+F3 ($D3)",
	PRESS_CONTROL_SHIFT_F4: "Atari: Press Control+Shift+F4 ($D4)",
	PRESS_CONTROL_SHIFT_B: "Atari: Press Control+Shift+B ($D5)",
	PRESS_CONTROL_SHIFT_X: "Atari: Press Control+Shift+X ($D6)",
	PRESS_CONTROL_SHIFT_Z: "Atari: Press Control+Shift+Z ($D7)",
	PRESS_CONTROL_SHIFT_4: "Atari: Press Control+Shift+4 ($D8)",
	PRESS_CONTROL_SHIFT_CODE_19: "Atari: Press key $D9 ($D9)",
	PRESS_CONTROL_SHIFT_3: "Atari: Press Control+Shift+3 ($DA)",
	PRESS_CONTROL_SHIFT_6: "Atari: Press Control+Shift+6 ($DB)",
	PRESS_CONTROL_SHIFT_ESC: "Atari: Press Control+Shift+Esc ($DC)",
	PRESS_CONTROL_SHIFT_5: "Atari: Press Control+Shift+5 ($DD)",
	PRESS_CONTROL_SHIFT_2: "Atari: Press Control+Shift+2 ($DE)",
	PRESS_CONTROL_SHIFT_1: "Atari: Press Control+Shift+1 ($DF)",
	PRESS_CONTROL_SHIFT_COMMA: "Atari: Press Control+Shift+Comma ($E0)",
	PRESS_CONTROL_SHIFT_SPACE: "Atari: Press Control+Shift+Space ($E1)",
	PRESS_CONTROL_SHIFT_PERIOD: "Atari: Press Control+Shift+Period ($E2)",
	PRESS_CONTROL_SHIFT_N: "Atari: Press Control+Shift+N ($E3)",
	PRESS_CONTROL_SHIFT_CODE_24: "Atari: Press key $E4 ($E4)",
	PRESS_CONTROL_SHIFT_M: "Atari: Press Control+Shift+M ($E5)",
	PRESS_CONTROL_SHIFT_SLASH: "Atari: Press Control+Shift+Slash ($E6)",
	PRESS_CONTROL_SHIFT_INVERSE_VIDEO:
		"Atari: Press Control+Shift+Inverse Video ($E7)",
	PRESS_CONTROL_SHIFT_R: "Atari: Press Control+Shift+R ($E8)",
	PRESS_CONTROL_SHIFT_CODE_29: "Atari: Press key $E9 ($E9)",
	PRESS_CONTROL_SHIFT_E: "Atari: Press Control+Shift+E ($EA)",
	PRESS_CONTROL_SHIFT_Y: "Atari: Press Control+Shift+Y ($EB)",
	PRESS_CONTROL_SHIFT_TAB: "Atari: Press Control+Shift+Tab ($EC)",
	PRESS_CONTROL_SHIFT_T: "Atari: Press Control+Shift+T ($ED)",
	PRESS_CONTROL_SHIFT_W: "Atari: Press Control+Shift+W ($EE)",
	PRESS_CONTROL_SHIFT_Q: "Atari: Press Control+Shift+Q ($EF)",
	PRESS_CONTROL_SHIFT_9: "Atari: Press Control+Shift+9 ($F0)",
	PRESS_CONTROL_SHIFT_CODE_31: "Atari: Press key $F1 ($F1)",
	PRESS_CONTROL_SHIFT_0: "Atari: Press Control+Shift+0 ($F2)",
	PRESS_CONTROL_SHIFT_7: "Atari: Press Control+Shift+7 ($F3)",
	PRESS_CONTROL_SHIFT_BACKSPACE: "Atari: Press Control+Shift+Backspace ($F4)",
	PRESS_CONTROL_SHIFT_8: "Atari: Press Control+Shift+8 ($F5)",
	PRESS_CONTROL_SHIFT_LESS_THAN: "Atari: Press Control+Shift+Less Than ($F6)",
	PRESS_CONTROL_SHIFT_GREATER_THAN:
		"Atari: Press Control+Shift+Greater Than ($F7)",
	PRESS_CONTROL_SHIFT_F: "Atari: Press Control+Shift+F ($F8)",
	PRESS_CONTROL_SHIFT_H: "Atari: Press Control+Shift+H ($F9)",
	PRESS_CONTROL_SHIFT_D: "Atari: Press Control+Shift+D ($FA)",
	PRESS_CONTROL_SHIFT_CODE_3B: "Atari: Press key $FB ($FB)",
	PRESS_CONTROL_SHIFT_CAPS: "Atari: Press Control+Shift+Caps ($FC)",
	PRESS_CONTROL_SHIFT_G: "Atari: Press Control+Shift+G ($FD)",
	PRESS_CONTROL_SHIFT_S: "Atari: Press Control+Shift+S ($FE)",
	PRESS_CONTROL_SHIFT_A: "Atari: Press Control+Shift+A ($FF)",
	PRESS_SHIFT: "Atari: Press Shift",
	PRESS_RESET: "Atari: Press Reset",
	PRESS_OPTION: "Atari: Press Option",
	PRESS_SELECT: "Atari: Press Select",
	PRESS_START: "Atari: Press Start",
	PRESS_BREAK: "Atari: Press Break",
	PRESS_JOY0_UP: "Atari: Push joystick 0 up",
	PRESS_JOY0_DOWN: "Atari: Push joystick 0 down",
	PRESS_JOY0_LEFT: "Atari: Push joystick 0 left",
	PRESS_JOY0_RIGHT: "Atari: Push joystick 0 right",
	PRESS_JOY0_TRIGGER: "Atari: Press joystick 0 trigger",
	PRESS_JOY1_UP: "Atari: Push joystick 1 up",
	PRESS_JOY1_DOWN: "Atari: Push joystick 1 down",
	PRESS_JOY1_LEFT: "Atari: Push joystick 1 left",
	PRESS_JOY1_RIGHT: "Atari: Push joystick 1 right",
	PRESS_JOY1_TRIGGER: "Atari: Press joystick 1 trigger",
	PRESS_JOY2_UP: "Atari: Push joystick 2 up",
	PRESS_JOY2_DOWN: "Atari: Push joystick 2 down",
	PRESS_JOY2_LEFT: "Atari: Push joystick 2 left",
	PRESS_JOY2_RIGHT: "Atari: Push joystick 2 right",
	PRESS_JOY2_TRIGGER: "Atari: Press joystick 2 trigger",
	PRESS_JOY3_UP: "Atari: Push joystick 3 up",
	PRESS_JOY3_DOWN: "Atari: Push joystick 3 down",
	PRESS_JOY3_LEFT: "Atari: Push joystick 3 left",
	PRESS_JOY3_RIGHT: "Atari: Push joystick 3 right",
	PRESS_JOY3_TRIGGER: "Atari: Press joystick 3 trigger",
} satisfies Record<string, string>;

export type LabelKey = keyof typeof labels;

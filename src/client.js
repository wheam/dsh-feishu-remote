// dsh-feishu-remote — browser (client) half: Web GUI settings card.
//
// A hand-written ModuleLoader module (no build step; shipped at ./client and
// copied verbatim to lib/client.js). It edits the `feishu-remote` settings
// namespace the Host plugin registers (flat schema), using only official
// client-runtime services (slots, settingsScope, locale, react).
//
// Mechanism borrowed from dsh-im-hub (MIT, ThreeBody6666/dsh-im-hub).
window.__ModuleLoader__.load({
	id: "dsh-feishu-remote",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let runtime = require("@deepseek-ai/dsh-client-runtime/client");

		// ---------------------------------------------------------------- css
		const css = ".fr_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:8px;list-style:none;overflow:hidden}.fr_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}.fr_header{cursor:pointer;text-align:left;width:100%;font:inherit;background:0 0;border:0;align-items:center;gap:8px;padding:10px 14px;display:flex}.fr_header:hover{background:var(--dsw-alias-interactive-bg-hover)}.fr_headText{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}.fr_name{color:var(--dsw-alias-label-primary);font-weight:600}.fr_description{color:var(--dsw-alias-label-tertiary);font-size:12px}.fr_pending{color:var(--dsw-alias-state-warn-primary);font-size:12px}.fr_chevron{color:var(--dsw-alias-label-tertiary);transition:transform .12s}.fr_chevronOpen{transform:rotate(180deg)}.fr_body{flex-direction:column;gap:14px;padding:0 14px 14px;display:flex}.fr_readOnly{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px}.fr_footer{justify-content:flex-end;align-items:center;gap:8px;display:flex}.fr_failed{color:var(--dsw-alias-state-error-primary);margin:0 auto 0 0;font-size:12px}.fr_discard,.fr_save{font:inherit;cursor:pointer;border-radius:6px;padding:5px 12px;font-size:13px}.fr_discard{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}.fr_discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.fr_save{border:1px solid var(--dsw-alias-button-info-fill);background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-label-primary-foreground)}.fr_save:hover:not(:disabled){border-color:var(--dsw-alias-button-info-hover);background:var(--dsw-alias-button-info-hover)}.fr_discard:active:not(:disabled),.fr_save:active:not(:disabled){transform:translateY(1px)}.fr_discard:focus-visible:not(:disabled),.fr_save:focus-visible:not(:disabled){outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.fr_discard:disabled,.fr_save:disabled{opacity:.5;cursor:default}.fr_field{flex-direction:column;gap:4px;display:flex}.fr_head{align-items:center;gap:8px;display:flex}.fr_label{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500}.fr_badges{align-items:center;gap:6px;display:flex}.fr_badge{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-state-business-primary);border-radius:999px;padding:1px 6px;font-size:11px}.fr_badgeMuted{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-label-tertiary);border-radius:999px;padding:1px 6px;font-size:11px}.fr_reset{color:var(--dsw-alias-state-business-primary);cursor:pointer;background:0 0;border:0;padding:0;font-size:11px}.fr_reset:hover:not(:disabled){text-decoration:underline}.fr_input,.fr_select{border:1px solid var(--dsw-alias-border-l2);font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border-radius:6px;padding:6px 8px;font-size:13px}.fr_inputInvalid{border:1px solid var(--dsw-alias-state-error-primary);font:inherit;color:var(--dsw-alias-label-primary);border-radius:6px;padding:6px 8px;font-size:13px}.fr_input:disabled,.fr_select:disabled{opacity:.6}.fr_hint{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px}.fr_invalid{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px}.fr_groupTitle{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin:2px 0 -4px}.fr_sep{height:1px;background:var(--dsw-alias-border-l2);margin:2px 0 0}";
		const pageCss = ".fr_page{flex-direction:column;gap:16px;display:flex;max-width:760px}.fr_pageHead{flex-direction:column;gap:4px;display:flex}.fr_pageTitle{margin:0;font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary)}.fr_pageDesc{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary)}.fr_pageGroup{margin:0 0 2px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.04em}";
		const readabilityCss = ".fr_field{gap:6px}.fr_label{display:block!important;color:#f2f6ff!important;line-height:1.4;opacity:1!important;visibility:visible!important}.fr_hint{display:block!important;color:#b8c6dd!important;line-height:1.45;opacity:1!important;visibility:visible!important}.fr_input::placeholder{color:#aebed8!important;opacity:1!important}.fr_input,.fr_select{min-height:34px}.fr_head{min-height:19px}";
		const onboardingCss = ".fr_onboarding{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:10px}.fr_onboardingHead{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.fr_onboardingTitle{margin:0;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600}.fr_onboardingDesc,.fr_onboardingMeta,.fr_onboardingError{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}.fr_onboardingError{color:var(--dsw-alias-state-error-primary)}.fr_status{border-radius:999px;padding:2px 8px;font-size:11px;white-space:nowrap;background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-label-secondary)}.fr_statusReady{color:var(--dsw-alias-state-success-primary)}.fr_statusBusy{color:var(--dsw-alias-state-warn-primary)}.fr_statusFailed{color:var(--dsw-alias-state-error-primary)}.fr_qrWrap{display:flex;flex-wrap:wrap;align-items:center;gap:14px}.fr_qr{width:220px;height:220px;object-fit:contain;background:#fff;border-radius:8px;padding:8px}.fr_qrHelp{display:flex;flex-direction:column;gap:6px;max-width:300px}.fr_qrLink{font-size:12px;color:var(--dsw-alias-state-business-primary)}.fr_actions{display:flex;flex-wrap:wrap;gap:8px}.fr_primary,.fr_secondary{font:inherit;cursor:pointer;border-radius:6px;padding:6px 11px;font-size:12px}.fr_primary{border:1px solid var(--dsw-alias-button-info-fill);background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-label-primary-foreground)}.fr_secondary{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary)}.fr_primary:disabled,.fr_secondary:disabled{opacity:.5;cursor:default}.fr_capabilities{display:flex;flex-wrap:wrap;gap:6px}.fr_capability{border-radius:999px;padding:2px 7px;font-size:11px;background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-label-secondary)}";
		const tagId = "dsh-feishu-remote/settings-card.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-feishu-remote";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css + pageCss + readabilityCss + onboardingCss;
			document.head.appendChild(tag);
		}
		const cssDefault = {
			"page": "fr_page", "pageHead": "fr_pageHead", "pageTitle": "fr_pageTitle",
			"pageDesc": "fr_pageDesc", "pageGroup": "fr_pageGroup",
			"badge": "fr_badge", "badgeMuted": "fr_badgeMuted", "badges": "fr_badges",
			"body": "fr_body", "card": "fr_card", "cardOpen": "fr_cardOpen",
			"chevron": "fr_chevron", "chevronOpen": "fr_chevronOpen",
			"description": "fr_description", "discard": "fr_discard", "failed": "fr_failed",
			"field": "fr_field", "footer": "fr_footer", "groupTitle": "fr_groupTitle",
			"head": "fr_head", "headText": "fr_headText", "header": "fr_header",
			"hint": "fr_hint", "input": "fr_input", "inputInvalid": "fr_inputInvalid",
			"invalid": "fr_invalid", "label": "fr_label", "name": "fr_name",
			"pending": "fr_pending", "readOnly": "fr_readOnly", "reset": "fr_reset",
			"save": "fr_save", "select": "fr_select", "sep": "fr_sep",
			"onboarding": "fr_onboarding", "onboardingHead": "fr_onboardingHead",
			"onboardingTitle": "fr_onboardingTitle", "onboardingDesc": "fr_onboardingDesc",
			"onboardingMeta": "fr_onboardingMeta", "onboardingError": "fr_onboardingError",
			"status": "fr_status", "statusReady": "fr_statusReady", "statusBusy": "fr_statusBusy",
			"statusFailed": "fr_statusFailed", "qrWrap": "fr_qrWrap", "qr": "fr_qr",
			"qrHelp": "fr_qrHelp", "qrLink": "fr_qrLink", "actions": "fr_actions",
			"primary": "fr_primary", "secondary": "fr_secondary", "capabilities": "fr_capabilities",
			"capability": "fr_capability"
		};

		// ------------------------------------------------------------ chrome
		function PluginSettingsCard(props) {
			const [open, setOpen] = react.useState(false);
			const { state } = props;
			if (!state.available) return null;
			const title = props.t(props.titleKey);
			const blocked = !state.dirty || state.invalid || state.saving;
			return react_jsx_runtime.jsxs("li", {
				className: open ? cssDefault.card + " " + cssDefault.cardOpen : cssDefault.card,
				children: [
					react_jsx_runtime.jsxs("button", {
						type: "button",
						className: cssDefault.header,
						onClick: () => setOpen((value) => !value),
						children: [
							react_jsx_runtime.jsxs("span", { className: cssDefault.headText, children: [
								react_jsx_runtime.jsx("span", { className: cssDefault.name, children: title }),
								react_jsx_runtime.jsx("span", { className: cssDefault.description, children: props.t(props.descriptionKey) })
							] }),
							state.dirty ? react_jsx_runtime.jsx("span", { className: cssDefault.pending, children: props.t("settings.unsaved") }) : null,
							react_jsx_runtime.jsx("span", {
								"aria-hidden": true,
								className: open ? cssDefault.chevron + " " + cssDefault.chevronOpen : cssDefault.chevron,
								children: "▾"
							})
						]
					}),
					open ? react_jsx_runtime.jsxs("div", { className: cssDefault.body, children: [
						!state.writable ? react_jsx_runtime.jsx("p", { className: cssDefault.readOnly, role: "status", children: props.t("settings.readOnly") }) : null,
						props.children,
						react_jsx_runtime.jsxs("div", { className: cssDefault.footer, children: [
							state.failed ? react_jsx_runtime.jsx("p", { className: cssDefault.failed, role: "status", children: props.t("settings.saveFailed") }) : null,
							react_jsx_runtime.jsx("button", { type: "button", className: cssDefault.discard, onClick: props.onDiscard, disabled: !state.dirty || state.saving, children: props.t("settings.discard") }),
							react_jsx_runtime.jsx("button", { type: "button", className: cssDefault.save, onClick: props.onSave, disabled: blocked, children: props.t(state.saving ? "settings.saving" : "settings.save") })
						] })
					] }) : null
				]
			});
		}

		// -------------------------------------------------------------- form
		function textField(field) {
			return {
				field,
				format: (value) => typeof value === "string" ? value : "",
				parse: (text) => text === "" ? { kind: "clear" } : { kind: "set", value: text }
			};
		}
		function numberField(field) {
			return {
				field,
				format: (value) => typeof value === "number" ? String(value) : "",
				parse: (text) => {
					if (text === "") return { kind: "clear" };
					const value = Number(text);
					return Number.isFinite(value) ? { kind: "set", value } : void 0;
				}
			};
		}
		function selectField(field, options) {
			return {
				field,
				options,
				format: (value) => typeof value === "string" ? value : "",
				parse: (text) => text === "" ? { kind: "clear" } : { kind: "set", value: text }
			};
		}
		function booleanField(field) {
			return {
				field,
				options: ["false", "true"],
				format: (value) => typeof value === "boolean" ? String(value) : "",
				parse: (text) => text === "" ? { kind: "clear" } : { kind: "set", value: text === "true" }
			};
		}

		var CardForm = class {
			constructor(scope, specs) {
				this.scope = scope;
				this.specs = new Map(specs.map((spec) => [spec.field, spec]));
				this.staged = new Map();
				this.listeners = new Set();
				this.saving = false;
				this.failed = false;
				scope.subscribe(() => this.publish());
			}
			bind(project) {
				const store = runtime.createSnapshotStore(project());
				this.listeners.add(() => store.set(project()));
				return store;
			}
			shell() {
				const snapshot = this.scope.getSnapshot();
				const plan = this.plan();
				return {
					available: snapshot.status === "ready",
					writable: snapshot.writable,
					dirty: plan.length > 0,
					invalid: plan.some((item) => item.run === void 0),
					saving: this.saving,
					failed: this.failed
				};
			}
			field(field) {
				const spec = this.specOf(field);
				const staged = this.staged.get(field);
				const snapshot = this.scope.getSnapshot();
				if (spec.secret === true) {
					const configured = snapshot.secrets?.some((entry) => entry.path?.length === 1 && entry.path[0] === field && entry.set);
					if (staged === void 0) return { text: "", overridden: false, invalid: false, configured };
					const write = spec.parse(staged.text);
					return { text: staged.text, overridden: write?.kind === "set", invalid: false, configured };
				}
				if (staged === void 0) return {
					text: spec.format(this.sectionValue(field)),
					overridden: this.stored(field),
					invalid: false
				};
				const write = staged.clear ? { kind: "clear" } : spec.parse(staged.text);
				return {
					text: staged.text,
					overridden: write?.kind === "set",
					invalid: write === void 0
				};
			}
			actions() {
				return {
					edit: (field, text) => this.stage(field, { text, clear: false }),
					resetField: (field) => {
						const spec = this.specOf(field);
						this.stage(field, spec.secret === true ? { text: "", clear: true } : { text: spec.format(this.baseValue(field)), clear: true });
					},
					save: () => this.save(),
					discard: () => {
						if (this.staged.size === 0 && !this.failed) return;
						this.staged.clear();
						this.failed = false;
						this.publish();
					}
				};
			}
			async save() {
				const plan = this.plan();
				const writes = plan.flatMap((item) => item.run === void 0 ? [] : [item.run]);
				if (plan.length === 0 || this.saving || writes.length !== plan.length) return;
				this.saving = true;
				this.failed = false;
				this.publish();
				let landed = true;
				for (const write of writes) landed = await write() && landed;
				if (landed) this.staged.clear();
				this.saving = false;
				this.failed = !landed;
				this.publish();
			}
			plan() {
				const plan = [];
				for (const [field, staged] of this.staged) {
					const spec = this.specOf(field);
					if (spec.secret === true) {
						if (staged.clear) {
							if (this.secretConfigured(field)) plan.push({ field, run: () => this.clear(field) });
							continue;
						}
						if (staged.text === "") continue;
						const write = spec.parse(staged.text);
						if (write === void 0) plan.push({ field, run: void 0 });
						else plan.push({ field, run: () => this.store(field, write.value) });
						continue;
					}
					if (staged.clear) {
						if (this.stored(field)) plan.push({ field, run: () => this.clear(field) });
						continue;
					}
					if (staged.text === spec.format(this.sectionValue(field))) continue;
					const write = spec.parse(staged.text);
					if (write === void 0) plan.push({ field, run: void 0 });
					else if (write.kind === "clear") plan.push({ field, run: () => this.clear(field) });
					else plan.push({ field, run: () => this.store(field, write.value) });
				}
				return plan;
			}
			async clear(field) {
				await this.scope.unset(field);
				return !this.stored(field);
			}
			async store(field, value) {
				await this.scope.set(field, value);
				return this.userLayer()?.[field] === value;
			}
			stage(field, edit) {
				this.staged.set(field, edit);
				this.failed = false;
				this.publish();
			}
			specOf(field) {
				const spec = this.specs.get(field);
				if (spec === void 0) throw new Error(`settings card has no field ${field}`);
				return spec;
			}
			sectionValue(field) {
				return this.scope.getSnapshot().value?.[field];
			}
			baseValue(field) {
				return this.scope.getSnapshot().base?.[field];
			}
			userLayer() {
				return this.scope.getSnapshot().user;
			}
			stored(field) {
				const user = this.userLayer();
				return user !== void 0 && Object.hasOwn(user, field);
			}
			secretConfigured(field) {
				return this.scope.getSnapshot().secrets?.some((entry) => entry.path?.length === 1 && entry.path[0] === field && entry.set) ?? false;
			}
			publish() {
				for (const listener of this.listeners) listener();
			}
		};

		// ------------------------------------------------------------- fields
		const FIELD_GROUPS = [
			{
				key: "credentials",
				fields: [
					{ field: "appId", spec: textField("appId"), kind: "text", labelKey: "f.appId", hintKey: "f.appIdHint", placeholderKey: "p.appId" },
					{ field: "appSecretRef", spec: textField("appSecretRef"), kind: "text", labelKey: "f.appSecretRef", hintKey: "f.appSecretRefHint", placeholderKey: "p.appSecretRef" },
					{ field: "brand", spec: selectField("brand", ["feishu", "lark"]), kind: "select", labelKey: "f.brand", hintKey: "f.brandHint" }
				]
			},
			{
				key: "security",
				fields: [
					{ field: "allowedOpenIds", spec: textField("allowedOpenIds"), kind: "text", labelKey: "f.allowedOpenIds", hintKey: "f.allowedOpenIdsHint", placeholderKey: "p.allowedOpenIds" },
					{ field: "allowedChatIds", spec: textField("allowedChatIds"), kind: "text", labelKey: "f.allowedChatIds", hintKey: "f.allowedChatIdsHint", placeholderKey: "p.allowedChatIds" },
					{ field: "allowAllUsers", spec: booleanField("allowAllUsers"), kind: "select", labelKey: "f.allowAllUsers", hintKey: "f.allowAllUsersHint" },
					{ field: "requireMention", spec: booleanField("requireMention"), kind: "select", labelKey: "f.requireMention", hintKey: "f.requireMentionHint" }
				]
			},
			{
				key: "workspace",
				fields: [
					{ field: "cwd", spec: textField("cwd"), kind: "text", labelKey: "f.cwd", hintKey: "f.cwdHint", placeholderKey: "p.cwd" },
					{ field: "workspaceRoot", spec: textField("workspaceRoot"), kind: "text", labelKey: "f.workspaceRoot", hintKey: "f.workspaceRootHint", placeholderKey: "p.workspaceRoot" }
				]
			},
			{
				key: "agent",
				fields: [
					{ field: "provider", spec: textField("provider"), kind: "text", labelKey: "f.provider", hintKey: "f.providerHint", placeholderKey: "p.provider" },
					{ field: "model", spec: textField("model"), kind: "text", labelKey: "f.model", hintKey: "f.modelHint", placeholderKey: "p.model" },
					{ field: "agentPreset", spec: textField("agentPreset"), kind: "text", labelKey: "f.agentPreset", hintKey: "f.agentPresetHint", placeholderKey: "p.agentPreset" }
				]
			},
			{
				key: "behavior",
				fields: [
					{ field: "progressUpdateMs", spec: numberField("progressUpdateMs"), kind: "number", labelKey: "f.progressUpdateMs", hintKey: "f.progressUpdateMsHint", placeholderKey: "p.progressUpdateMs" },
					{ field: "interactiveTimeoutMs", spec: numberField("interactiveTimeoutMs"), kind: "number", labelKey: "f.interactiveTimeoutMs", hintKey: "f.interactiveTimeoutMsHint", placeholderKey: "p.interactiveTimeoutMs" },
					{ field: "maxLiveAgents", spec: numberField("maxLiveAgents"), kind: "number", labelKey: "f.maxLiveAgents", hintKey: "f.maxLiveAgentsHint", placeholderKey: "p.maxLiveAgents" },
					{ field: "commandAllowlist", spec: textField("commandAllowlist"), kind: "text", labelKey: "f.commandAllowlist", hintKey: "f.commandAllowlistHint", placeholderKey: "p.commandAllowlist" }
				]
			},
			{
				key: "context",
				fields: [
					{ field: "contextMode", spec: selectField("contextMode", ["off", "auto"]), kind: "select", labelKey: "f.contextMode", hintKey: "f.contextModeHint" },
					{ field: "contextBackend", spec: selectField("contextBackend", ["auto", "cli", "sdk"]), kind: "select", labelKey: "f.contextBackend", hintKey: "f.contextBackendHint" },
					// feishuCliPath deliberately absent: arbitrary-exec path stays a
					// trusted-admin setting (docs/15 F-09), not GUI-editable.
					{ field: "contextP2pMaxMessages", spec: numberField("contextP2pMaxMessages"), kind: "number", labelKey: "f.contextP2pMaxMessages", hintKey: "f.contextP2pMaxMessagesHint", placeholderKey: "p.contextP2pMaxMessages" },
					{ field: "contextP2pMaxChars", spec: numberField("contextP2pMaxChars"), kind: "number", labelKey: "f.contextP2pMaxChars", hintKey: "f.contextP2pMaxCharsHint", placeholderKey: "p.contextP2pMaxChars" },
					{ field: "contextMaxMessages", spec: numberField("contextMaxMessages"), kind: "number", labelKey: "f.contextMaxMessages", hintKey: "f.contextMaxMessagesHint", placeholderKey: "p.contextMaxMessages" },
					{ field: "contextMaxChars", spec: numberField("contextMaxChars"), kind: "number", labelKey: "f.contextMaxChars", hintKey: "f.contextMaxCharsHint", placeholderKey: "p.contextMaxChars" },
					{ field: "contextTimeoutMs", spec: numberField("contextTimeoutMs"), kind: "number", labelKey: "f.contextTimeoutMs", hintKey: "f.contextTimeoutMsHint", placeholderKey: "p.contextTimeoutMs" },
					{ field: "contextIncludeBot", spec: booleanField("contextIncludeBot"), kind: "select", labelKey: "f.contextIncludeBot", hintKey: "f.contextIncludeBotHint" }
				]
			}
		];

		function Field(props) {
			const { spec, kind, labelKey, hintKey, placeholderKey, t, fieldProps, state, onEdit, onReset } = props;
			const common = {
				id: `plugin-config-feishu-remote-${spec.field}`,
				label: t(labelKey),
				placeholder: placeholderKey ? t(placeholderKey) : "",
				disabled: fieldProps.disabled
			};
			if (kind === "secret") {
				return react_jsx_runtime.jsxs("div", { className: cssDefault.field, children: [
					react_jsx_runtime.jsxs("div", { className: cssDefault.head, children: [
						react_jsx_runtime.jsx("label", { className: cssDefault.label, htmlFor: common.id, children: common.label }),
						react_jsx_runtime.jsxs("div", { className: cssDefault.badges, children: [
							react_jsx_runtime.jsx("span", { className: state.configured ? cssDefault.badge : cssDefault.badgeMuted, children: state.configured ? t("f.configured") : t("f.notConfigured") }),
							state.configured ? react_jsx_runtime.jsx("button", { type: "button", className: cssDefault.reset, onClick: onReset, disabled: common.disabled, children: t("settings.reset") }) : null
						] })
					] }),
					react_jsx_runtime.jsx("input", {
						className: cssDefault.input, id: common.id, type: "password",
						value: state.text, placeholder: common.placeholder, disabled: common.disabled,
						onChange: (event) => onEdit(event.target.value)
					}),
					react_jsx_runtime.jsx("p", { className: cssDefault.hint, children: t(hintKey) })
				] });
			}
			if (kind === "select") {
				return react_jsx_runtime.jsxs("div", { className: cssDefault.field, children: [
					react_jsx_runtime.jsxs("div", { className: cssDefault.head, children: [
						react_jsx_runtime.jsx("label", { className: cssDefault.label, htmlFor: common.id, children: common.label }),
						state.overridden ? react_jsx_runtime.jsxs("div", { className: cssDefault.badges, children: [
							react_jsx_runtime.jsx("span", { className: cssDefault.badge, children: t("settings.overridden") }),
							react_jsx_runtime.jsx("button", { type: "button", className: cssDefault.reset, onClick: onReset, disabled: common.disabled, children: t("settings.reset") })
						] }) : null
					] }),
					react_jsx_runtime.jsxs("select", {
						className: cssDefault.select, id: common.id, value: state.text, disabled: common.disabled,
						onChange: (event) => onEdit(event.target.value),
						children: spec.options.map((option) => react_jsx_runtime.jsx("option", { value: option, children: option }))
					}),
					react_jsx_runtime.jsx("p", { className: cssDefault.hint, children: t(hintKey) })
				] });
			}
			return react_jsx_runtime.jsxs("div", { className: cssDefault.field, children: [
				react_jsx_runtime.jsxs("div", { className: cssDefault.head, children: [
					react_jsx_runtime.jsx("label", { className: cssDefault.label, htmlFor: common.id, children: common.label }),
					state.overridden ? react_jsx_runtime.jsxs("div", { className: cssDefault.badges, children: [
						react_jsx_runtime.jsx("span", { className: cssDefault.badge, children: t("settings.overridden") }),
						react_jsx_runtime.jsx("button", { type: "button", className: cssDefault.reset, onClick: onReset, disabled: common.disabled, children: t("settings.reset") })
					] }) : null
				] }),
				react_jsx_runtime.jsx("input", {
					className: state.invalid ? cssDefault.inputInvalid : cssDefault.input,
					id: common.id, type: kind === "number" ? "text" : "text", inputMode: kind === "number" ? "numeric" : void 0,
					value: state.text, placeholder: common.placeholder, disabled: common.disabled,
					onChange: (event) => onEdit(event.target.value)
				}),
				state.invalid ? react_jsx_runtime.jsx("p", { className: cssDefault.invalid, children: t("settings.invalidNumber") }) : null,
				react_jsx_runtime.jsx("p", { className: cssDefault.hint, children: t(hintKey) })
			] });
		}

		function onboardingStatusKey(status) {
			if (status === void 0) return "onboarding.status.loading";
			if (status.connected) return "onboarding.status.connected";
			return `onboarding.status.${status.phase}`;
		}

		function capabilityLabel(t, label, state) {
			return `${t(label)}：${t(`onboarding.capability.${state ?? "unknown"}`)}`;
		}
		function onboardingActive(status) {
			return ["starting", "qr_ready", "committing", "connecting"].includes(status?.phase);
		}

		function OnboardingPanel(props) {
			const hook = props.usePersonalAgentOnboarding;
			if (hook === void 0) return null;
			const snapshot = hook((value) => value);
			const status = snapshot?.status;
			const phase = status?.phase ?? "idle";
			const active = onboardingActive(status);
			const canCancel = phase === "starting" || phase === "qr_ready";
			const configured = status?.configured === true;
			const canUpdate = configured || status?.recoverableApp === true;
			const acting = snapshot?.acting === true;
			const writable = props.writable !== false;
			const loopbackOnly = snapshot?.loopbackOnly === true;
			const blocked = active || acting || !writable || props.cardDirty === true || loopbackOnly;
			const capabilityKnown = status?.capabilities !== void 0 && (status.capabilities.core !== "unknown" || status.capabilities.enhanced !== "unknown");
			const confirmUpdate = () => {
				const appSuffix = status?.app?.appIdSuffix ?? "unknown";
				const message = props.t("onboarding.updateConfirm").replace("{app}", appSuffix);
				if (typeof window !== "undefined" && !window.confirm(message)) return;
				props.onboardingStart("update");
			};
			const statusClass = status?.connected
				? cssDefault.status + " " + cssDefault.statusReady
				: phase === "failed" || phase === "expired"
					? cssDefault.status + " " + cssDefault.statusFailed
					: active ? cssDefault.status + " " + cssDefault.statusBusy : cssDefault.status;
			const secondsLeft = status?.expiresAt === void 0
				? void 0
				: Math.max(0, Math.ceil((status.expiresAt - Date.now()) / 1000));
			return react_jsx_runtime.jsxs("div", { className: cssDefault.onboarding, children: [
				react_jsx_runtime.jsxs("div", { className: cssDefault.onboardingHead, children: [
					react_jsx_runtime.jsxs("div", { children: [
						react_jsx_runtime.jsx("h3", { className: cssDefault.onboardingTitle, children: props.t("onboarding.title") }),
						react_jsx_runtime.jsx("p", { className: cssDefault.onboardingDesc, children: props.t("onboarding.description") })
					] }),
					react_jsx_runtime.jsx("span", { className: statusClass, role: "status", children: props.t(onboardingStatusKey(status)) })
				] }),
				status?.qrUrl ? react_jsx_runtime.jsxs("div", { className: cssDefault.qrWrap, children: [
					status.qrImageDataUrl
						? react_jsx_runtime.jsx("img", { className: cssDefault.qr, src: status.qrImageDataUrl, alt: props.t("onboarding.qrAlt") })
						: react_jsx_runtime.jsx("div", { className: cssDefault.qr, "aria-label": props.t("onboarding.qrRendering") }),
					react_jsx_runtime.jsxs("div", { className: cssDefault.qrHelp, children: [
						react_jsx_runtime.jsx("p", { className: cssDefault.onboardingMeta, children: props.t("onboarding.scanHint") }),
						secondsLeft === void 0 ? null : react_jsx_runtime.jsx("p", { className: cssDefault.onboardingMeta, children: `${props.t("onboarding.expiresIn")} ${secondsLeft}s` }),
						react_jsx_runtime.jsx("a", { className: cssDefault.qrLink, href: status.qrUrl, target: "_blank", rel: "noreferrer", children: props.t("onboarding.openLink") })
					] })
				] }) : null,
				status?.app ? react_jsx_runtime.jsx("p", {
					className: cssDefault.onboardingMeta,
					children: [status.app.botName, status.app.brand, `App …${status.app.appIdSuffix}`, status.app.ownerOpenIdSuffix ? `owner …${status.app.ownerOpenIdSuffix}` : void 0].filter(Boolean).join(" · ")
				}) : null,
				capabilityKnown ? react_jsx_runtime.jsxs("div", { className: cssDefault.capabilities, children: [
					react_jsx_runtime.jsx("span", { className: cssDefault.capability, children: capabilityLabel(props.t, "onboarding.core", status.capabilities.core) }),
					react_jsx_runtime.jsx("span", { className: cssDefault.capability, children: capabilityLabel(props.t, "onboarding.enhanced", status.capabilities.enhanced) })
				] }) : null,
				status?.capabilities !== void 0 && !capabilityKnown ? react_jsx_runtime.jsx("p", { className: cssDefault.onboardingMeta, children: props.t("onboarding.capabilityUnavailable") }) : null,
				status?.error ? react_jsx_runtime.jsx("p", { className: cssDefault.onboardingError, role: "alert", children: status.error.message }) : null,
				loopbackOnly ? react_jsx_runtime.jsx("p", { className: cssDefault.onboardingError, role: "status", children: props.t("onboarding.loopbackOnly") }) : null,
				snapshot?.transportError ? react_jsx_runtime.jsx("p", { className: cssDefault.onboardingError, role: "alert", children: snapshot.transportError }) : null,
				react_jsx_runtime.jsxs("div", { className: cssDefault.actions, children: [
					react_jsx_runtime.jsx("button", {
						type: "button", className: cssDefault.primary,
						disabled: blocked,
						onClick: () => props.onboardingStart("create"),
						children: props.t(configured ? "onboarding.rebind" : "onboarding.create")
					}),
					canUpdate ? react_jsx_runtime.jsx("button", {
						type: "button", className: cssDefault.secondary,
						disabled: blocked,
						onClick: confirmUpdate,
						children: props.t("onboarding.grant")
					}) : null,
					phase === "failed" && configured ? react_jsx_runtime.jsx("button", {
						type: "button", className: cssDefault.secondary,
						disabled: acting || !writable,
						onClick: props.onboardingRetry,
						children: props.t("onboarding.retry")
					}) : null,
					canCancel ? react_jsx_runtime.jsx("button", {
						type: "button", className: cssDefault.secondary,
						disabled: acting || !writable,
						onClick: props.onboardingCancel,
						children: props.t("onboarding.cancel")
					}) : null
				] }),
				react_jsx_runtime.jsx("p", { className: cssDefault.onboardingMeta, children: props.t("onboarding.manualHint") })
			] });
		}

		function FeishuRemoteSettingsCard(props) {
			const { t } = props;
			const state = props.useFeishuRemoteSettingsCard((snapshot) => snapshot);
			const onboarding = props.usePersonalAgentOnboarding?.((snapshot) => snapshot);
			const active = onboardingActive(onboarding?.status);
			const disabled = !state.writable || active;
			const fieldProps = { disabled };
			return react_jsx_runtime.jsx(PluginSettingsCard, {
				t,
				titleKey: "settings.title",
				descriptionKey: "settings.description",
				state: { ...state, invalid: state.invalid || active },
				onSave: active ? () => {} : props.save,
					onDiscard: props.discard,
					children: [
						react_jsx_runtime.jsx(OnboardingPanel, { ...props, key: "onboarding", writable: state.writable, cardDirty: state.dirty }),
					...FIELD_GROUPS.map((group) => react_jsx_runtime.jsxs(react.Fragment, {
					key: group.key,
					children: [
						react_jsx_runtime.jsx("p", { className: cssDefault.groupTitle, children: t(`g.${group.key}`) }),
						group.fields.map((entry) => react_jsx_runtime.jsx(Field, {
							spec: entry.spec,
							kind: entry.kind,
							labelKey: entry.labelKey,
							hintKey: entry.hintKey,
							placeholderKey: entry.placeholderKey,
							t,
							fieldProps,
							state: state[entry.field] ?? { text: "", overridden: false, invalid: false, configured: false },
							onEdit: (text) => props.edit(entry.field, text),
							onReset: () => props.resetField(entry.field)
						}, entry.field)),
						react_jsx_runtime.jsx("div", { className: cssDefault.sep })
					]
					}))
				]
			});
		}

		/** 设置页顶层分区（与「文件提及」同级）：整页表单，非折叠卡片。 */
		function FeishuRemoteSection(props) {
			const { t } = props;
			const hook = props.useFeishuRemoteSettingsCard;
			if (hook === void 0 || t === void 0) return null;
			const state = hook((snapshot) => snapshot);
			if (state === void 0) return null;
			const onboarding = props.usePersonalAgentOnboarding?.((snapshot) => snapshot);
			const active = onboardingActive(onboarding?.status);
			const disabled = !state.writable || active;
			const fieldProps = { disabled };
			const blocked = !state.dirty || state.invalid || state.saving || active;
			return react_jsx_runtime.jsxs("div", { className: cssDefault.page, children: [
				react_jsx_runtime.jsxs("div", { className: cssDefault.pageHead, children: [
					react_jsx_runtime.jsx("h2", { className: cssDefault.pageTitle, children: t("settings.title") }),
					react_jsx_runtime.jsx("p", { className: cssDefault.pageDesc, children: t("settings.description") }),
					state.dirty ? react_jsx_runtime.jsx("span", { className: cssDefault.pending, children: t("settings.unsaved") }) : null,
					!state.writable ? react_jsx_runtime.jsx("p", { className: cssDefault.readOnly, role: "status", children: t("settings.readOnly") }) : null
				] }),
					react_jsx_runtime.jsx(OnboardingPanel, { ...props, key: "onboarding", writable: state.writable, cardDirty: state.dirty }),
				...FIELD_GROUPS.map((group) => react_jsx_runtime.jsxs(react.Fragment, {
					key: group.key,
					children: [
						react_jsx_runtime.jsx("p", { className: cssDefault.pageGroup, children: t(`g.${group.key}`) }),
						group.fields.map((entry) => react_jsx_runtime.jsx(Field, {
							spec: entry.spec,
							kind: entry.kind,
							labelKey: entry.labelKey,
							hintKey: entry.hintKey,
							placeholderKey: entry.placeholderKey,
							t,
							fieldProps,
							state: state[entry.field] ?? { text: "", overridden: false, invalid: false, configured: false },
							onEdit: (text) => props.edit(entry.field, text),
							onReset: () => props.resetField(entry.field)
						}, entry.field)),
						react_jsx_runtime.jsx("div", { className: cssDefault.sep })
					]
				})),
				react_jsx_runtime.jsxs("div", { className: cssDefault.footer, children: [
					state.failed ? react_jsx_runtime.jsx("p", { className: cssDefault.failed, role: "status", children: t("settings.saveFailed") }) : null,
					react_jsx_runtime.jsx("button", { type: "button", className: cssDefault.discard, onClick: props.discard, disabled: !state.dirty || state.saving, children: t("settings.discard") }),
					react_jsx_runtime.jsx("button", { type: "button", className: cssDefault.save, onClick: props.save, disabled: blocked, children: t(state.saving ? "settings.saving" : "settings.save") })
				] })
			] });
		}

		var FeishuRemoteSettingsCardController = class {
			constructor(scope) {
				this.form = new CardForm(scope, FIELD_GROUPS.flatMap((group) => group.fields.map((entry) => entry.spec)));
				this.store = this.form.bind(() => this.projection());
			}
			projection() {
				return {
					...this.form.shell(),
					...Object.fromEntries(FIELD_GROUPS.flatMap((group) => group.fields.map((entry) => [entry.field, this.form.field(entry.field)])))
				};
			}
			inject() {
				return {
					hooks: { feishuRemoteSettingsCard: this.store },
					...this.form.actions()
				};
			}
		};

		var PersonalAgentOnboardingController = class {
			constructor(connection) {
				this.connection = connection;
				this.snapshot = { status: void 0, acting: false, transportError: void 0, loopbackOnly: connection.isLoopback === false };
				this.store = runtime.createSnapshotStore(this.snapshot);
				this.stopped = true;
				this.pending = false;
				this.timer = void 0;
				this.requestSequence = 0;
			}
			publish(patch) {
				this.snapshot = { ...this.snapshot, ...patch };
				this.store.set(this.snapshot);
			}
			async request(endpoint, payload = {}) {
				const result = await this.connection.rpc.call("/dsh-feishu-remote", endpoint, payload);
				if (!result.ok) throw new Error(result.error.message);
				return result.value;
			}
			async refresh() {
				if (this.pending || this.stopped || this.snapshot.acting || this.snapshot.loopbackOnly) return;
				this.pending = true;
				const requestId = ++this.requestSequence;
				try {
					const status = await this.request("onboarding/status");
					if (requestId === this.requestSequence) this.publish({ status, transportError: void 0 });
				} catch (error) {
					if (requestId === this.requestSequence) this.publish({ transportError: error instanceof Error ? error.message : String(error) });
				} finally {
					this.pending = false;
				}
			}
			async invoke(endpoint, payload = {}) {
				if (this.snapshot.acting || this.snapshot.loopbackOnly) return;
				const requestId = ++this.requestSequence;
				this.publish({ acting: true, transportError: void 0 });
				try {
					const status = await this.request(endpoint, payload);
					if (requestId === this.requestSequence) this.publish({ status, transportError: void 0 });
				} catch (error) {
					if (requestId === this.requestSequence) this.publish({ transportError: error instanceof Error ? error.message : String(error) });
				} finally {
					if (requestId === this.requestSequence) this.publish({ acting: false });
				}
			}
			mount() {
				this.stopped = false;
				if (this.snapshot.loopbackOnly) return () => { this.stopped = true; };
				const tick = async () => {
					await this.refresh();
					if (this.stopped) return;
					const active = onboardingActive(this.snapshot.status);
					this.timer = setTimeout(tick, active ? 750 : 2500);
				};
				void tick();
				return () => {
					this.stopped = true;
					if (this.timer !== void 0) clearTimeout(this.timer);
				};
			}
			inject() {
				return {
					hooks: { personalAgentOnboarding: this.store },
					onboardingStart: (mode) => this.invoke("onboarding/start", { mode }),
					onboardingCancel: () => this.invoke("onboarding/cancel"),
					onboardingRetry: () => this.invoke("onboarding/retry")
				};
			}
		};

		// -------------------------------------------------------------- apply
		const NS = "dsh-feishu-remote";
		const SETTINGS_NS = "feishu-remote";
		const inject = ["slots", "settingsScope", "locale", "connection", "remote"];

		const en = {
			"settings.title": "Feishu Remote (dsh-feishu-remote)",
			"settings.description": "Control the running DeepSeek Harness from a Feishu bot — thread-per-session, approval cards, fail-closed sender allowlist.",
			"settings.expand": "Expand", "settings.collapse": "Collapse", "settings.unsaved": "Unsaved changes",
			"settings.readOnly": "This deployment is read-only: settings cannot be changed from the GUI.",
			"settings.overridden": "Override", "settings.reset": "Reset", "settings.invalidNumber": "Enter a valid number",
			"settings.discard": "Discard", "settings.save": "Save", "settings.saving": "Saving…", "settings.saveFailed": "Save failed",
			"onboarding.title": "Create and bind your Feishu bot",
			"onboarding.description": "One Feishu/Lark scan creates a PersonalAgent owned by you, saves its secret on this Host, and connects it. No developer-console setup or chat pairing code.",
			"onboarding.create": "Create and bind bot", "onboarding.rebind": "Create a new bot", "onboarding.grant": "Grant missing permissions",
			"onboarding.retry": "Retry connection", "onboarding.cancel": "Cancel", "onboarding.qrAlt": "Feishu PersonalAgent authorization QR code",
			"onboarding.qrRendering": "Rendering QR code", "onboarding.scanHint": "Scan with the Feishu/Lark mobile app, review the permission list, then confirm.",
			"onboarding.expiresIn": "Expires in", "onboarding.openLink": "Open the authorization link on this device",
			"onboarding.manualHint": "Advanced fields below remain available for an existing manually-created app.",
			"onboarding.loopbackOnly": "For security, bot creation is available only when this page is opened on the Host itself (localhost).",
			"onboarding.updateConfirm": "Re-authorize App …{app} with the requested messaging, event, card, history, and reaction permissions? Feishu will show the final permission diff before applying it.",
			"onboarding.capabilityUnavailable": "This tenant did not expose a complete permission projection; connection health is used as the final readiness check.",
			"onboarding.core": "Core remote", "onboarding.enhanced": "Enhanced experience",
			"onboarding.capability.ok": "granted", "onboarding.capability.missing": "partially missing", "onboarding.capability.unknown": "awaiting verification",
			"onboarding.status.loading": "Loading", "onboarding.status.idle": "Not set up", "onboarding.status.starting": "Generating QR code",
			"onboarding.status.qr_ready": "Waiting for scan", "onboarding.status.committing": "Saving securely", "onboarding.status.connecting": "Connecting",
			"onboarding.status.ready": "Ready", "onboarding.status.connected": "Connected", "onboarding.status.failed": "Needs attention",
			"onboarding.status.cancelled": "Cancelled", "onboarding.status.expired": "QR expired",
			"g.credentials": "Feishu app credentials",
			"g.security": "Security (fail-closed)",
			"g.workspace": "Legacy workspace compatibility",
			"g.agent": "Agent",
			"g.behavior": "Behavior",
			"g.context": "Feishu context",
			"f.configured": "Configured", "f.notConfigured": "Not set",
			"f.secretHint": "Stored server-side; never shown again. Leave blank to keep the current value.",
			"f.appId": "App id", "f.appIdHint": "App id of the Feishu/Lark custom app (cli_…).",
			"f.appSecretRef": "App secret credential ref", "f.appSecretRefHint": "Name of the credential in .credentials.yaml (the single secret source; the value itself is never edited here).",
			"f.brand": "Account brand", "f.brandHint": "Detected automatically by QR onboarding; choose Feishu or Lark for a manually configured app.",
			"f.allowedOpenIds": "Allowed open ids", "f.allowedOpenIdsHint": "Comma-separated ou_… ids. Empty = EVERYONE is rejected (fail-closed); only allowAllUsers opens it.",
			"f.allowedChatIds": "Restrict to group chat ids", "f.allowedChatIdsHint": "Optional comma-separated oc_… ids. Empty = every group the bot joins; non-empty = only those groups.",
			"f.allowAllUsers": "Allow all users", "f.allowAllUsersHint": "DANGEROUS: opens the remote executor to every sender. Only for mock/test environments.",
			"f.requireMention": "Require first @mention per topic", "f.requireMentionHint": "Topic chats: on keeps each topic silent until its first @mention, then later replies flow without @. Ordinary groups always require @ on every task.",
			"f.cwd": "Legacy working directory", "f.cwdHint": "Optional compatibility value for fixed-workspace deployments. New Feishu chats choose a DSH Workspace with /workspace. If set, workspaceRoot must also be set.",
			"f.workspaceRoot": "Legacy workspace root", "f.workspaceRootHint": "Optional compatibility boundary paired with cwd; it is not the default for newly bound Feishu chats.",
			"f.provider": "Provider", "f.providerHint": "Override model provider; empty = deployment default.",
			"f.model": "Model", "f.modelHint": "Override model; empty = deployment default.",
			"f.agentPreset": "Agent preset", "f.agentPresetHint": "Preset id to mount (empty = deployment default, usually standard).",
			"f.progressUpdateMs": "Card update throttle (ms)", "f.progressUpdateMsHint": "Mutable-card patch cadence; default 600ms.",
			"f.interactiveTimeoutMs": "Approval timeout (ms)", "f.interactiveTimeoutMsHint": "Pending approvals settle as unavailable after this; default 10min.",
			"f.maxLiveAgents": "Max live agents", "f.maxLiveAgentsHint": "Hard cap on live sessions (0 = unlimited).",
			"f.commandAllowlist": "Native command allowlist", "f.commandAllowlistHint": "Comma-separated Harness command names allowed to pass through; anything else is rejected.",
			"f.contextMode": "Context backfill", "f.contextModeHint": "auto = inject Feishu thread/chat history before each plain message (off disables it).",
			"f.contextBackend": "Context backend", "f.contextBackendHint": "auto prefers the official lark-cli and falls back to the bundled SDK; cli/sdk force one.",
			"f.contextP2pMaxMessages": "Private-chat message cap", "f.contextP2pMaxMessagesHint": "Additional cap for long-running private chats (1-500; default 80, about two CLI pages). The global cap still applies.",
			"f.contextP2pMaxChars": "Private-chat character cap", "f.contextP2pMaxCharsHint": "Additional character cap for private chats (1000-500000; default 50000). The global cap still applies.",
			"f.contextMaxMessages": "Thread/global message cap", "f.contextMaxMessagesHint": "Global ceiling and thread window size per injection (1-500; default 150).",
			"f.contextMaxChars": "Thread/global character cap", "f.contextMaxCharsHint": "Global ceiling and thread character window (1000-500000; default 100000).",
			"f.contextTimeoutMs": "Context fetch timeout (ms)", "f.contextTimeoutMsHint": "History fetch timeout; on timeout the message proceeds without context (fail-open).",
			"f.contextIncludeBot": "Include bot replies", "f.contextIncludeBotHint": "Keep the bot's own history replies in the context window."
		};

		const zh = {
			"settings.title": "飞书遥控（dsh-feishu-remote）",
			"settings.description": "用飞书机器人操控正在运行的 DeepSeek Harness：话题级会话、审批卡片、fail-closed 发送者白名单。",
			"settings.expand": "展开", "settings.collapse": "收起", "settings.unsaved": "有未保存的修改",
			"settings.readOnly": "当前部署为只读：GUI 无法修改设置。",
			"settings.overridden": "已覆盖", "settings.reset": "重置", "settings.invalidNumber": "请输入有效数字",
			"settings.discard": "放弃", "settings.save": "保存", "settings.saving": "保存中…", "settings.saveFailed": "保存失败",
			"onboarding.title": "创建并绑定你的飞书机器人",
			"onboarding.description": "用飞书/Lark 扫一次码，即可创建归你所有的 PersonalAgent、在本机安全保存凭据并连接；无需进入开发者后台，也没有第二次聊天配对。",
			"onboarding.create": "创建并绑定机器人", "onboarding.rebind": "重新创建机器人", "onboarding.grant": "补开缺失权限",
			"onboarding.retry": "重试连接", "onboarding.cancel": "取消", "onboarding.qrAlt": "飞书 PersonalAgent 授权二维码",
			"onboarding.qrRendering": "正在生成二维码", "onboarding.scanHint": "请用手机飞书/Lark 扫码，核对权限清单后确认创建。",
			"onboarding.expiresIn": "剩余", "onboarding.openLink": "在本机打开授权链接",
			"onboarding.manualHint": "下方高级字段继续支持已有的手工自建应用。",
			"onboarding.loopbackOnly": "出于安全考虑，创建机器人只能在 Host 本机通过 localhost 打开的设置页中进行。",
			"onboarding.updateConfirm": "确认给 App …{app} 补开本插件申请的消息、事件、卡片、历史与 reaction 权限吗？飞书会在应用前再次展示最终权限差异。",
			"onboarding.capabilityUnavailable": "当前租户未返回完整权限投影；页面将以机器人长连接健康状态作为最终就绪依据。",
			"onboarding.core": "核心遥控", "onboarding.enhanced": "增强体验",
			"onboarding.capability.ok": "已授权", "onboarding.capability.missing": "部分缺失", "onboarding.capability.unknown": "待验证",
			"onboarding.status.loading": "正在读取", "onboarding.status.idle": "尚未开通", "onboarding.status.starting": "正在生成二维码",
			"onboarding.status.qr_ready": "等待扫码", "onboarding.status.committing": "正在安全保存", "onboarding.status.connecting": "正在连接",
			"onboarding.status.ready": "已就绪", "onboarding.status.connected": "已连接", "onboarding.status.failed": "需要处理",
			"onboarding.status.cancelled": "已取消", "onboarding.status.expired": "二维码已过期",
			"g.credentials": "飞书应用凭据",
			"g.security": "安全（fail-closed）",
			"g.workspace": "旧版工作区兼容",
			"g.agent": "智能体",
			"g.behavior": "行为",
			"g.context": "飞书上下文",
			"f.configured": "已配置", "f.notConfigured": "未设置",
			"f.secretHint": "凭据仅保存在服务端，不会回显；留空表示保持原值。",
			"f.appId": "App ID", "f.appIdHint": "飞书/Lark 自建应用的 App ID（cli_…）。",
			"f.appSecretRef": "App Secret 凭据引用", "f.appSecretRefHint": ".credentials.yaml 中的凭据名（唯一凭据来源；值本身不在这里编辑）。",
			"f.brand": "账号品牌", "f.brandHint": "扫码开通时自动识别；手工配置应用时请选择飞书或 Lark。",
			"f.allowedOpenIds": "允许的 open_id", "f.allowedOpenIdsHint": "逗号分隔的 ou_…。留空 = 拒绝所有人（fail-closed）；只有 allowAllUsers 显式开启才全开放。",
			"f.allowedChatIds": "限定群聊 ID", "f.allowedChatIdsHint": "可选，逗号分隔的 oc_…。留空 = 机器人加入的任意群都可用；填写后仅限这些群。",
			"f.allowAllUsers": "允许所有用户", "f.allowAllUsersHint": "危险：把远程执行入口开放给所有发送者。仅建议 mock/测试环境开启。",
			"f.requireMention": "每个话题首次必须 @机器人", "f.requireMentionHint": "话题群：开启后首次 @ 前只积累历史，此后同话题免 @；普通群不受此开关影响，每一轮任务都必须明确 @。",
			"f.cwd": "旧版工作目录", "f.cwdHint": "可选，仅兼容固定工作区的旧部署。新飞书聊天通过 /workspace 选择 DSH Workspace；填写时必须同时填写 workspaceRoot。",
			"f.workspaceRoot": "旧版工作区根目录", "f.workspaceRootHint": "可选，与 cwd 成对使用的兼容边界；不会作为新飞书聊天的默认目录。",
			"f.provider": "Provider", "f.providerHint": "覆盖模型 provider；留空 = 部署默认。",
			"f.model": "模型", "f.modelHint": "覆盖模型；留空 = 部署默认。",
			"f.agentPreset": "Agent preset", "f.agentPresetHint": "要挂载的 preset id（留空 = 部署默认，通常 standard）。",
			"f.progressUpdateMs": "卡片更新节流（毫秒）", "f.progressUpdateMsHint": "可变进度卡 patch 节奏；默认 600ms。",
			"f.interactiveTimeoutMs": "审批超时（毫秒）", "f.interactiveTimeoutMsHint": "待审批超过该时长结算为 unavailable；默认 10 分钟。",
			"f.maxLiveAgents": "live agent 上限", "f.maxLiveAgentsHint": "live 会话硬上限（0 = 不限）。",
			"f.commandAllowlist": "原生命令透传白名单", "f.commandAllowlistHint": "逗号分隔的 Harness 命令名；其余命令一律拒绝。",
			"f.contextMode": "上下文回填", "f.contextModeHint": "auto = 每条普通消息前注入飞书话题/聊天历史；off 完全关闭。",
			"f.contextBackend": "上下文获取后端", "f.contextBackendHint": "auto 优先官方 lark-cli、装不上自动降级已打包的 SDK；cli/sdk 强制其一。",
			"f.contextP2pMaxMessages": "私聊消息条数上限", "f.contextP2pMaxMessagesHint": "长期私聊的额外上限（1-500；默认 80，约两页 CLI 基础读取）；仍受全局上限约束。",
			"f.contextP2pMaxChars": "私聊字符上限", "f.contextP2pMaxCharsHint": "私聊的额外字符上限（1000-500000；默认 50000）；仍受全局上限约束。",
			"f.contextMaxMessages": "话题/全局消息上限", "f.contextMaxMessagesHint": "全局硬上限，同时是话题单次注入窗口（1-500；默认 150）。",
			"f.contextMaxChars": "话题/全局字符上限", "f.contextMaxCharsHint": "全局硬上限，同时是话题字符窗口（1000-500000；默认 100000）。",
			"f.contextTimeoutMs": "上下文拉取超时（毫秒）", "f.contextTimeoutMsHint": "历史拉取超时；超时后消息照常处理、本次不注入（fail-open）。",
			"f.contextIncludeBot": "包含机器人自己的回复", "f.contextIncludeBotHint": "上下文窗口中是否保留机器人自己的历史回复。"
		};

		const placeholders = {
			en: {
				"p.appId": "Example: cli_xxxxxxxxxxxxx",
				"p.appSecretRef": "Example: DSH_FEISHU_APP_SECRET",
				"p.allowedOpenIds": "Example: ou_xxxxxxxxxxxxx",
				"p.allowedChatIds": "Example: oc_xxxxxxxxxxxxx",
				"p.cwd": "Optional legacy value: /Users/you/work",
				"p.workspaceRoot": "Optional legacy value: /Users/you/work",
				"p.provider": "Example: deepseek",
				"p.model": "Example: deepseek-v4-flash",
				"p.agentPreset": "Example: standard",
				"p.progressUpdateMs": "Example: 600",
				"p.interactiveTimeoutMs": "Example: 600000",
				"p.maxLiveAgents": "Example: 8 (0 = unlimited)",
				"p.commandAllowlist": "Example: status, sessions",
				"p.contextP2pMaxMessages": "Example: 80",
				"p.contextP2pMaxChars": "Example: 50000",
				"p.contextMaxMessages": "Example: 150",
				"p.contextMaxChars": "Example: 100000",
				"p.contextTimeoutMs": "Example: 10000"
			},
			zh: {
				"p.appId": "例如：cli_xxxxxxxxxxxxx",
				"p.appSecretRef": "例如：DSH_FEISHU_APP_SECRET",
				"p.allowedOpenIds": "例如：ou_xxxxxxxxxxxxx",
				"p.allowedChatIds": "例如：oc_xxxxxxxxxxxxx",
				"p.cwd": "可选旧版配置，例如：/Users/you/work",
				"p.workspaceRoot": "可选旧版配置，例如：/Users/you/work",
				"p.provider": "例如：deepseek",
				"p.model": "例如：deepseek-v4-flash",
				"p.agentPreset": "例如：standard",
				"p.progressUpdateMs": "例如：600",
				"p.interactiveTimeoutMs": "例如：600000",
				"p.maxLiveAgents": "例如：8（0 = 不限）",
				"p.commandAllowlist": "例如：status, sessions",
				"p.contextP2pMaxMessages": "例如：80",
				"p.contextP2pMaxChars": "例如：50000",
				"p.contextMaxMessages": "例如：150",
				"p.contextMaxChars": "例如：100000",
				"p.contextTimeoutMs": "例如：10000"
			}
		};

		// ------------------------------------------------ legacy transcript display
		const FEISHU_CONTEXT_PREFIX = '{"type":"feishu-context"';

		/**
		 * Return the user-visible suffix after one leading feishu-context JSON
		 * object. This is deliberately a structural JSON scan rather than a regex:
		 * quoted braces and escaped quotes inside chat history must not end the
		 * frame early.
		 */
		function splitLegacyFeishuMessageText(text) {
			if (typeof text !== "string" || !text.startsWith(FEISHU_CONTEXT_PREFIX)) return void 0;
			let depth = 0;
			let inString = false;
			let escaped = false;
			for (let index = 0; index < text.length; index += 1) {
				const char = text[index];
				if (inString) {
					if (escaped) escaped = false;
					else if (char === "\\") escaped = true;
					else if (char === '"') inString = false;
					continue;
				}
				if (char === '"') inString = true;
				else if (char === "{") depth += 1;
				else if (char === "}") {
					depth -= 1;
					if (depth !== 0) continue;
					const rawFrame = text.slice(0, index + 1);
					const visible = text.slice(index + 1);
					if (visible === "") return void 0;
					try {
						const frame = JSON.parse(rawFrame);
						return frame !== null && typeof frame === "object" && frame.type === "feishu-context"
							? visible
							: void 0;
					} catch {
						return void 0;
					}
				}
			}
			return void 0;
		}

		/**
		 * Clean already-persisted pre-fix rows without rewriting session logs.
		 * New turns are split on the Host before persistence, so this observer is
		 * only a backward-compatibility projection for old user/message events.
		 */
		function installLegacyFeishuTranscriptProjection() {
			if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
			let queued = false;
			let stopped = false;
			const scan = () => {
				queued = false;
				if (stopped) return;
				for (const row of document.querySelectorAll('[data-chat-flow-kind="user"]')) {
					let target;
					let visible;
					for (const element of [row, ...row.querySelectorAll("*")]) {
						const candidate = splitLegacyFeishuMessageText(element.textContent ?? "");
						if (candidate === void 0) continue;
						target = element;
						visible = candidate;
					}
					if (target !== void 0 && visible !== void 0) {
						target.replaceChildren(document.createTextNode(visible));
						target.setAttribute("data-feishu-context-projected", "true");
					}
				}
			};
			const schedule = () => {
				if (queued || stopped) return;
				queued = true;
				queueMicrotask(scan);
			};
			const observer = new MutationObserver(schedule);
			observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
			schedule();
			return () => {
				stopped = true;
				observer.disconnect();
			};
		}

		function apply(ctx) {
			try {
				ctx.effect(installLegacyFeishuTranscriptProjection, "dsh-feishu-remote: legacy transcript projection");
			} catch (error) {
				console.error("[dsh-feishu-remote] 旧会话显示兼容层加载失败（不影响宿主界面）：", error);
			}
			// 前端优雅降级（docs/11 事故教训）：无论未来 slot/API 契约如何变化，
			// 本模块的任何注册失败只影响自己的设置卡（不显示 + 控制台报错），
			// 绝不拖垮宿主界面。keyed-slot 契约已在 dsh 0.1.1-rc.2 复核。
			try {
				ctx.effect(() => ctx.locale.register(NS, { en: { ...en, ...placeholders.en }, zh: { ...zh, ...placeholders.zh } }), "dsh-feishu-remote: dictionaries");
				const settingsScope = ctx.settingsScope.bind({ namespace: SETTINGS_NS });
				const settingsController = new FeishuRemoteSettingsCardController(settingsScope);
				const onboardingController = new PersonalAgentOnboardingController(ctx.connection);
				ctx.effect(() => onboardingController.mount(), "dsh-feishu-remote: PersonalAgent onboarding polling");
				const injection = () => {
					const settings = settingsController.inject();
					const onboarding = onboardingController.inject();
					return {
						...settings,
						...onboarding,
						hooks: { ...settings.hooks, ...onboarding.hooks }
					};
				};
				ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
					name: "settings.plugin.item",
					key: SETTINGS_NS,
					locale: NS,
					inject: injection
				}, FeishuRemoteSettingsCard));
				// 设置页顶层分区（左侧栏独立一项，与「文件提及」同级）
				try {
					const t = ctx.locale.bind(NS);
					ctx.slots.inject("settings.section", () => ctx.slots.register({
						name: "settings.section",
						id: "feishu-remote",
						order: 18,
						label: () => t("settings.title"),
						locale: NS,
						inject: injection
					}, FeishuRemoteSection));
				} catch (error) {
					console.error("[dsh-feishu-remote] 设置页分区注册失败（不影响折叠卡片）：", error);
				}
			} catch (error) {
				console.error("[dsh-feishu-remote] 设置卡注册失败（卡片将不显示，宿主界面不受影响）：", error);
			}
		}
		exports.apply = apply;
		exports.inject = inject;
		exports.splitLegacyFeishuMessageText = splitLegacyFeishuMessageText;
		return module.exports;
	}
});

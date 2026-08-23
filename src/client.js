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
		const readabilityCss = ".fr_field{gap:6px}.fr_label{display:block!important;color:var(--dsw-alias-label-primary)!important;line-height:1.4;opacity:1!important;visibility:visible!important}.fr_hint{display:block!important;color:var(--dsw-alias-label-secondary)!important;line-height:1.45;opacity:1!important;visibility:visible!important}.fr_input::placeholder{color:var(--dsw-alias-label-tertiary)!important;opacity:1!important}.fr_input,.fr_select{min-height:34px}.fr_head{min-height:19px}";
		const onboardingCss = ".fr_onboarding{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:10px}.fr_onboardingHead{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.fr_onboardingTitle{margin:0;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600}.fr_onboardingDesc,.fr_onboardingMeta,.fr_onboardingError{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}.fr_onboardingError{color:var(--dsw-alias-state-error-primary)}.fr_status{border-radius:999px;padding:2px 8px;font-size:11px;white-space:nowrap;background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-label-secondary)}.fr_statusReady{color:var(--dsw-alias-state-success-primary)}.fr_statusBusy{color:var(--dsw-alias-state-warn-primary)}.fr_statusFailed{color:var(--dsw-alias-state-error-primary)}.fr_qrWrap{display:flex;flex-wrap:wrap;align-items:center;gap:14px}.fr_qr{width:220px;height:220px;object-fit:contain;background:#fff;border-radius:8px;padding:8px}.fr_qrHelp{display:flex;flex-direction:column;gap:6px;max-width:300px}.fr_qrLink{font-size:12px;color:var(--dsw-alias-state-business-primary)}.fr_actions{display:flex;flex-wrap:wrap;gap:8px}.fr_primary,.fr_secondary{font:inherit;cursor:pointer;border-radius:6px;padding:6px 11px;font-size:12px}.fr_primary{border:1px solid var(--dsw-alias-button-info-fill);background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-label-primary-foreground)}.fr_secondary{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary)}.fr_primary:disabled,.fr_secondary:disabled{opacity:.5;cursor:default}.fr_capabilities{display:flex;flex-wrap:wrap;gap:6px}.fr_capability{border-radius:999px;padding:2px 7px;font-size:11px;background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-label-secondary)}.fr_botList{display:flex;flex-direction:column;gap:12px}.fr_botIntro{display:flex;flex-direction:column;gap:3px;min-width:0}.fr_botCard{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);padding:0 14px 12px}.fr_botSummary{cursor:pointer;padding:13px 0;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:10px;list-style:none}.fr_botSummary::-webkit-details-marker{display:none}.fr_botSummaryText{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}.fr_botSummaryName{font-size:14px;font-weight:600}.fr_botSummaryMeta{font-size:11px;font-weight:400;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fr_botSummaryAside{display:flex;align-items:center;gap:8px}.fr_botSummaryChevron{color:var(--dsw-alias-label-tertiary);font-size:14px;transition:transform .12s}.fr_botCard[open]>.fr_botSummary .fr_botSummaryChevron{transform:rotate(180deg)}.fr_botStatusBadge{border-radius:999px;padding:2px 8px;font-size:11px;font-weight:500;white-space:nowrap;background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-label-secondary)}.fr_botStatusBadgeOk{color:var(--dsw-alias-state-success-primary)}.fr_botStatusBadgeError{color:var(--dsw-alias-state-error-primary)}.fr_botSection{border-top:1px solid var(--dsw-alias-border-l2);padding:12px 0 2px;display:flex;flex-direction:column;gap:10px}.fr_botSectionTitle{margin:0;color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600}.fr_botSectionDesc{margin:-6px 0 0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.45}.fr_botGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.fr_botWide{grid-column:1/-1}.fr_botStatus{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0 0 10px}.fr_botStatusError{color:var(--dsw-alias-state-error-primary)}.fr_botToolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.fr_botAdvanced{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 12px 12px;background:var(--dsw-alias-bg-layer-2)}.fr_botAdvancedSummary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;padding:10px 0}.fr_botDisclosure{border-top:1px solid var(--dsw-alias-border-l2)}.fr_botDisclosureSummary{cursor:pointer;list-style:none;padding:12px 0;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600}.fr_botDisclosureSummary::-webkit-details-marker{display:none}.fr_botDisclosureSummary:after{content:'›';color:var(--dsw-alias-label-tertiary);font-size:16px;line-height:1;transition:transform .12s}.fr_botDisclosure[open]>.fr_botDisclosureSummary:after{transform:rotate(90deg)}.fr_botDisclosureMeta{color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:400;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fr_botDisclosureBody{display:flex;flex-direction:column;gap:10px;padding:0 0 12px}.fr_botQuickToggles{grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.fr_botQuickToggle{border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:9px 10px;background:var(--dsw-alias-bg-layer-3);display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-primary);font-size:12px}.fr_botLimit{max-width:360px}.fr_checkbox{display:flex;align-items:center;gap:7px;color:var(--dsw-alias-label-primary);font-size:13px}.fr_botDanger{align-self:flex-start;margin-top:2px}@media(max-width:640px){.fr_botGrid,.fr_botQuickToggles{grid-template-columns:1fr}.fr_botWide{grid-column:auto}.fr_botToolbar{align-items:stretch}.fr_botLimit{max-width:none;width:100%}.fr_botSummaryMeta{max-width:180px}.fr_botDisclosureMeta{max-width:180px}}";
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
			,"botList":"fr_botList","botIntro":"fr_botIntro","botCard":"fr_botCard","botSummary":"fr_botSummary","botSummaryText":"fr_botSummaryText","botSummaryName":"fr_botSummaryName","botSummaryMeta":"fr_botSummaryMeta","botSummaryAside":"fr_botSummaryAside","botSummaryChevron":"fr_botSummaryChevron","botStatusBadge":"fr_botStatusBadge","botStatusBadgeOk":"fr_botStatusBadgeOk","botStatusBadgeError":"fr_botStatusBadgeError","botSection":"fr_botSection","botSectionTitle":"fr_botSectionTitle","botSectionDesc":"fr_botSectionDesc","botGrid":"fr_botGrid","botWide":"fr_botWide","botStatus":"fr_botStatus","botStatusError":"fr_botStatusError","botToolbar":"fr_botToolbar","botAdvanced":"fr_botAdvanced","botAdvancedSummary":"fr_botAdvancedSummary","botDisclosure":"fr_botDisclosure","botDisclosureSummary":"fr_botDisclosureSummary","botDisclosureMeta":"fr_botDisclosureMeta","botDisclosureBody":"fr_botDisclosureBody","botQuickToggles":"fr_botQuickToggles","botQuickToggle":"fr_botQuickToggle","botLimit":"fr_botLimit","checkbox":"fr_checkbox","botDanger":"fr_botDanger"
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
						props.hideFooter ? null : react_jsx_runtime.jsxs("div", { className: cssDefault.footer, children: [
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
				try {
					for (const write of writes) landed = await write() && landed;
					if (landed) this.staged.clear();
				} catch {
					landed = false;
				} finally {
					this.saving = false;
					this.failed = !landed;
					this.publish();
				}
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
					{ field: "defaultWorkspace", spec: textField("defaultWorkspace"), kind: "text", labelKey: "f.defaultWorkspace", hintKey: "f.defaultWorkspaceHint", placeholderKey: "p.defaultWorkspace" },
					{ field: "workspacePolicy", spec: selectField("workspacePolicy", ["default", "locked"]), kind: "select", labelKey: "f.workspacePolicy", hintKey: "f.workspacePolicyHint" },
					{ field: "profileFile", spec: textField("profileFile"), kind: "text", labelKey: "f.profileFile", hintKey: "f.profileFileHint", placeholderKey: "p.profileFile" },
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

		const BOT_TEXT_FIELD_GROUPS = {
			connection: [
				["appId", "飞书 App ID（必填）"],
				["appSecretRef", "App Secret 凭据引用（必填）"],
			],
			access: [
				["allowedOpenIds", "允许使用机器人的用户 open_id（逗号分隔）", "list"],
				["allowedChatIds", "限定可用的群聊 ID（可留空）", "list"],
			],
			workspace: [
				["defaultWorkspace", "默认工作区（可留空）"],
			],
			agent: [
				["profileFile", "角色说明文件（Profile）"],
				["agentPreset", "Agent 预设"], ["provider", "模型提供方"], ["model", "模型"],
			],
			advanced: [
				["id", "机器人内部标识"],
				["maxLiveAgents", "这个机器人同时运行的任务上限", "number"],
			],
		};
		const BOT_SELECT_FIELDS = {
			brand: ["brand", "平台", [["feishu", "飞书"], ["lark", "Lark"], ["larkoffice", "Lark Office"]]],
			workspacePolicy: ["workspacePolicy", "工作区使用方式", [["default", "允许聊天选择工作区"], ["locked", "始终使用默认工作区"]]],
			contextMode: ["contextMode", "读取飞书聊天上下文", [["auto", "自动"], ["off", "关闭"]]],
			contextBackend: ["contextBackend", "上下文连接方式", [["auto", "自动"], ["sdk", "飞书 SDK"]]],
		};
		const BOT_EDITABLE_KEYS = [
			"id", "enabled", "appId", "appSecretRef", "brand", "allowedOpenIds", "allowedChatIds",
			"allowAllUsers", "requireMention", "defaultWorkspace", "workspacePolicy", "agentPreset",
			"profileFile", "provider", "model", "maxLiveAgents", "contextMode", "contextBackend"
		];
		function serializeBotDraft(bot) {
			return Object.fromEntries(BOT_EDITABLE_KEYS.filter(key => Object.hasOwn(bot, key)).map(key => {
				const raw = bot[key];
				const value = (key === "allowedOpenIds" || key === "allowedChatIds") && typeof raw === "string"
					? raw.split(/[\s,]+/).filter(Boolean) : raw;
				return [key, value];
			}));
		}

		function botPresentation(bot, index, status) {
			const appId = typeof bot.appId === "string" ? bot.appId.trim() : "";
			const role = bot.sessionNamespace === "legacy" ? "主机器人" : `机器人 ${index + 1}`;
			const runtimeName = typeof status?.botName === "string" ? status.botName.trim() : "";
			const name = appId === "" ? "新机器人" : runtimeName || role;
			const maskedApp = appId === "" ? "尚未填写 App ID" : appId.length <= 12 ? `App ID：${appId}` : `App ID：${appId.slice(0, 4)}…${appId.slice(-6)}`;
			const appLabel = runtimeName === "" || appId === "" ? maskedApp : `${role} · ${maskedApp}`;
			if (bot.enabled === false) return { name, appLabel, statusLabel: "已停用", statusTone: "muted", detail: "这个机器人当前已停用。" };
			if (appId === "" || typeof bot.appSecretRef !== "string" || bot.appSecretRef.trim() === "") return { name, appLabel, statusLabel: "待完成", statusTone: "error", detail: "请填写 App ID 和 App Secret 凭据引用，然后保存。" };
			if (status === void 0) return { name, appLabel, statusLabel: "读取中", statusTone: "muted", detail: "正在读取机器人连接状态…" };
			if (status.error) return { name, appLabel, statusLabel: "需要处理", statusTone: "error", detail: status.error };
			const live = Number.isFinite(status.liveAgents) ? status.liveAgents : 0;
			if (status.connected) return { name, appLabel, statusLabel: "已连接", statusTone: "ok", detail: `连接正常 · 当前运行 ${live} 个任务` };
			if (status.status === "starting") return { name, appLabel, statusLabel: "连接中", statusTone: "muted", detail: "机器人正在建立连接…" };
			return { name, appLabel, statusLabel: "未连接", statusTone: "error", detail: "机器人当前未连接，请展开检查配置。" };
		}

		function botListCount(value) {
			if (Array.isArray(value)) return value.filter(Boolean).length;
			if (typeof value !== "string") return 0;
			return value.split(/[\s,]+/).filter(Boolean).length;
		}

		function botAccessSummary(bot) {
			if (bot.allowAllUsers === true) return "所有人都可以使用（有风险）";
			const users = botListCount(bot.allowedOpenIds);
			const chats = botListCount(bot.allowedChatIds);
			if (users === 0) return "尚未授权用户";
			return `已授权 ${users} 位用户${chats > 0 ? ` · 限定 ${chats} 个群聊` : ""}`;
		}

		function botAgentSummary(bot) {
			const preset = typeof bot.agentPreset === "string" ? bot.agentPreset.trim() : "";
			const model = typeof bot.model === "string" ? bot.model.trim() : "";
			const profile = typeof bot.profileFile === "string" ? bot.profileFile.trim() : "";
			const values = [preset ? `预设 ${preset}` : "", model ? `模型 ${model}` : "", profile ? "已设置角色说明" : ""].filter(Boolean);
			return values.length > 0 ? values.join(" · ") : "使用系统默认";
		}

		function botConnectionSummary(bot) {
			const brand = bot.brand === "lark" || bot.brand === "larkoffice" ? "Lark" : "飞书";
			return `${brand} · 凭据已安全保存`;
		}

		function BotField(props) {
			const raw = props.bot[props.field];
			const value = props.kind === "list" && Array.isArray(raw) ? raw.join(", ") : String(raw ?? "");
			return react_jsx_runtime.jsxs("label", { className: props.wide ? cssDefault.field + " " + cssDefault.botWide : cssDefault.field, children: [
				react_jsx_runtime.jsx("span", { className: cssDefault.label, children: props.label }),
				react_jsx_runtime.jsx("input", {
					className: cssDefault.input, value, disabled: props.disabled,
					inputMode: props.kind === "number" ? "numeric" : void 0,
					onChange: (event) => {
						const text = event.target.value;
					const next = props.kind === "number" ? (text === "" ? 0 : Number(text)) : text;
						props.onEdit(props.field, next);
					}
				})
			] });
		}

		function BotSelectField(props) {
			const [field, label, options] = props.spec;
			return react_jsx_runtime.jsxs("label", { className: props.wide ? cssDefault.field + " " + cssDefault.botWide : cssDefault.field, children: [
				react_jsx_runtime.jsx("span", { className: cssDefault.label, children: label }),
				react_jsx_runtime.jsx("select", {
					className: cssDefault.select,
					value: props.bot[field] ?? options[0][0],
					disabled: props.disabled,
					onChange: (event) => props.onEdit(field, event.target.value),
					children: options.map(([value, text]) => react_jsx_runtime.jsx("option", { value, children: text }, value))
				})
			] });
		}

		function BotTextFields(props) {
			return props.fields.map(([field, label, kind]) => react_jsx_runtime.jsx(BotField, {
				bot: props.bot, field, label, kind, disabled: props.disabled,
				wide: field === "defaultWorkspace" || field === "profileFile" || field === "allowedOpenIds" || field === "allowedChatIds",
				onEdit: props.onEdit,
			}, field));
		}

		function BotSection(props) {
			return react_jsx_runtime.jsxs("section", { className: cssDefault.botSection, children: [
				react_jsx_runtime.jsx("h4", { className: cssDefault.botSectionTitle, children: props.title }),
				props.description ? react_jsx_runtime.jsx("p", { className: cssDefault.botSectionDesc, children: props.description }) : null,
				react_jsx_runtime.jsx("div", { className: cssDefault.botGrid, children: props.children })
			] });
		}

		function BotDisclosure(props) {
			return react_jsx_runtime.jsxs("details", { className: cssDefault.botDisclosure, children: [
				react_jsx_runtime.jsxs("summary", { className: cssDefault.botDisclosureSummary, children: [
					react_jsx_runtime.jsx("span", { children: props.title }),
					react_jsx_runtime.jsx("span", { className: cssDefault.botDisclosureMeta, children: props.summary })
				] }),
				react_jsx_runtime.jsx("div", { className: cssDefault.botDisclosureBody, children: props.children })
			] });
		}

		function BotEditor(props) {
			const [open, setOpen] = react.useState(!props.bot.appId);
			const presentation = botPresentation(props.bot, props.index, props.status);
			const badgeClass = presentation.statusTone === "ok"
				? cssDefault.botStatusBadge + " " + cssDefault.botStatusBadgeOk
				: presentation.statusTone === "error"
					? cssDefault.botStatusBadge + " " + cssDefault.botStatusBadgeError
					: cssDefault.botStatusBadge;
			return react_jsx_runtime.jsxs("details", { className: cssDefault.botCard, open, onToggle: event => setOpen(event.currentTarget.open), children: [
				react_jsx_runtime.jsxs("summary", { className: cssDefault.botSummary, children: [
					react_jsx_runtime.jsxs("span", { className: cssDefault.botSummaryText, children: [
						react_jsx_runtime.jsx("span", { className: cssDefault.botSummaryName, children: presentation.name }),
						react_jsx_runtime.jsx("span", { className: cssDefault.botSummaryMeta, children: presentation.appLabel })
					] }),
					react_jsx_runtime.jsxs("span", { className: cssDefault.botSummaryAside, children: [
						react_jsx_runtime.jsx("span", { className: badgeClass, children: presentation.statusLabel }),
						react_jsx_runtime.jsx("span", { className: cssDefault.botSummaryChevron, "aria-hidden": true, children: "⌄" })
					] })
				] }),
				react_jsx_runtime.jsx("p", { className: presentation.statusTone === "error" ? cssDefault.botStatus + " " + cssDefault.botStatusError : cssDefault.botStatus, children: presentation.detail }),
				react_jsx_runtime.jsx(BotSection, { title: "常用设置", description: "扫码生成的连接和权限通常无需修改；日常只需设置工作区和群聊响应方式。", children: [
					react_jsx_runtime.jsxs("div", { className: cssDefault.botQuickToggles, children: [
						react_jsx_runtime.jsxs("label", { className: cssDefault.botQuickToggle, children: [
							react_jsx_runtime.jsx("input", { type: "checkbox", checked: props.bot.enabled !== false, disabled: props.disabled, onChange: event => props.onEdit("enabled", event.target.checked) }),
							"启用机器人"
						] }),
						react_jsx_runtime.jsxs("label", { className: cssDefault.botQuickToggle, children: [
							react_jsx_runtime.jsx("input", { type: "checkbox", checked: props.bot.requireMention !== false, disabled: props.disabled, onChange: event => props.onEdit("requireMention", event.target.checked) }),
							"话题首次使用需要 @机器人"
						] })
					] }),
					react_jsx_runtime.jsx(BotSelectField, { spec: BOT_SELECT_FIELDS.workspacePolicy, bot: props.bot, disabled: props.disabled, wide: true, onEdit: props.onEdit }),
					...BotTextFields({ fields: BOT_TEXT_FIELD_GROUPS.workspace, bot: props.bot, disabled: props.disabled, onEdit: props.onEdit }),
				] }),
				react_jsx_runtime.jsx(BotDisclosure, { title: "访问控制", summary: botAccessSummary(props.bot), children: react_jsx_runtime.jsxs("div", { className: cssDefault.botGrid, children: [
					react_jsx_runtime.jsxs("label", { className: cssDefault.checkbox + " " + cssDefault.botWide, children: [
						react_jsx_runtime.jsx("input", { type: "checkbox", checked: props.bot.allowAllUsers === true, disabled: props.disabled, onChange: event => props.onEdit("allowAllUsers", event.target.checked) }),
						"允许任何人使用（不建议）"
					] }),
					...BotTextFields({ fields: BOT_TEXT_FIELD_GROUPS.access, bot: props.bot, disabled: props.disabled, onEdit: props.onEdit }),
				] }) }),
				react_jsx_runtime.jsx(BotDisclosure, { title: "角色与模型", summary: botAgentSummary(props.bot), children: react_jsx_runtime.jsxs("div", { className: cssDefault.botGrid, children: [
					react_jsx_runtime.jsx(BotSelectField, { spec: BOT_SELECT_FIELDS.contextMode, bot: props.bot, disabled: props.disabled, onEdit: props.onEdit }),
					...BotTextFields({ fields: BOT_TEXT_FIELD_GROUPS.agent, bot: props.bot, disabled: props.disabled, onEdit: props.onEdit }),
				] }) }),
				react_jsx_runtime.jsx(BotDisclosure, { title: "连接与高级配置", summary: botConnectionSummary(props.bot), children: react_jsx_runtime.jsxs(react.Fragment, { children: [
					react_jsx_runtime.jsxs("div", { className: cssDefault.botGrid, children: [
						react_jsx_runtime.jsx(BotSelectField, { spec: BOT_SELECT_FIELDS.brand, bot: props.bot, disabled: props.disabled, onEdit: props.onEdit }),
						...BotTextFields({ fields: BOT_TEXT_FIELD_GROUPS.connection, bot: props.bot, disabled: props.disabled, onEdit: props.onEdit }),
						react_jsx_runtime.jsx(BotSelectField, { spec: BOT_SELECT_FIELDS.contextBackend, bot: props.bot, disabled: props.disabled, onEdit: props.onEdit }),
						...BotTextFields({ fields: BOT_TEXT_FIELD_GROUPS.advanced, bot: props.bot, disabled: props.disabled, onEdit: props.onEdit }),
					] }),
					react_jsx_runtime.jsx("button", { type: "button", className: cssDefault.secondary + " " + cssDefault.botDanger, disabled: props.disabled, onClick: props.onDelete, children: "移除此机器人" })
				] }) })
			] });
		}

		function MultiBotPanel(props) {
			const [addingBot, setAddingBot] = react.useState(false);
			const [managingLegacy, setManagingLegacy] = react.useState(false);
			const [preparingAdd, setPreparingAdd] = react.useState(false);
			const [addStarted, setAddStarted] = react.useState(false);
			const [addBaselineRevision, setAddBaselineRevision] = react.useState(-1);
			const hook = props.useFeishuBotAdmin;
			if (hook === void 0) return null;
			const state = hook(value => value);
			const onboardingHook = props.usePersonalAgentOnboarding;
			const onboardingState = onboardingHook === void 0 ? void 0 : onboardingHook(value => value);
			const onboardingBusy = onboardingActive(onboardingState?.status) || onboardingState?.acting === true;
			const onboardingStatus = onboardingState?.status;
			const legacyConfigured = state?.legacyConfigured === true || onboardingStatus?.configured === true;
			const beginAdd = async () => {
				if (state.saving || state.dirty || onboardingBusy || !state.writable) return;
				setAddBaselineRevision(onboardingStatus?.revision ?? -1);
				setAddStarted(false);
				if (state.mode === "legacy") {
					setPreparingAdd(true);
					const converted = await props.convertLegacy();
					setPreparingAdd(false);
					if (!converted) return;
				}
				setManagingLegacy(false);
				setAddingBot(true);
			};
			react.useEffect(() => {
				if (!addingBot || !addStarted || onboardingStatus?.destination !== "new-bot"
					|| onboardingStatus.phase !== "ready" || (onboardingStatus.revision ?? -1) <= addBaselineRevision) return;
				void props.refreshBots?.();
				setAddingBot(false);
				setAddStarted(false);
			}, [addingBot, addStarted, addBaselineRevision, onboardingStatus?.revision]);
			if (!state?.loaded) return react_jsx_runtime.jsx("p", { className: cssDefault.hint, children: "正在加载机器人配置…" });
			if (state.mode === "unavailable") return react_jsx_runtime.jsxs("div", { className: cssDefault.onboarding, children: [
				react_jsx_runtime.jsx("h3", { className: cssDefault.onboardingTitle, children: "机器人设置仅限 Host 本机" }),
				react_jsx_runtime.jsx("p", { className: cssDefault.onboardingError, children: state.error ?? "请在 Host 的 localhost 设置页管理机器人；此处不显示可能已失效的 legacy 字段。" })
			] });
			if (state.mode === "legacy") {
				const app = onboardingStatus?.app;
				const connected = onboardingStatus?.connected === true;
				const statusClass = connected
					? cssDefault.botStatusBadge + " " + cssDefault.botStatusBadgeOk
					: cssDefault.botStatusBadge + " " + cssDefault.botStatusBadgeError;
				return react_jsx_runtime.jsxs("div", { className: cssDefault.botList, children: [
					react_jsx_runtime.jsxs("div", { className: cssDefault.botToolbar, children: [
						react_jsx_runtime.jsxs("div", { className: cssDefault.botIntro, children: [
							react_jsx_runtime.jsx("h3", { className: cssDefault.onboardingTitle, children: "机器人管理" }),
							react_jsx_runtime.jsx("p", { className: cssDefault.onboardingDesc, children: legacyConfigured ? "已连接 1 个机器人。添加机器人不会替换当前机器人。" : "连接一个飞书机器人后，就可以从飞书远程使用 DSH。" })
						] }),
						react_jsx_runtime.jsx("button", {
							type: "button", className: cssDefault.primary,
							disabled: state.saving || props.cardDirty || onboardingBusy || !state.writable,
							onClick: legacyConfigured ? beginAdd : () => setManagingLegacy(true),
							children: preparingAdd ? "正在准备…" : legacyConfigured ? "添加机器人" : "连接机器人"
						})
					] }),
					legacyConfigured ? react_jsx_runtime.jsxs("div", { className: cssDefault.botCard, children: [
						react_jsx_runtime.jsxs("div", { className: cssDefault.botSummary, children: [
							react_jsx_runtime.jsxs("span", { className: cssDefault.botSummaryText, children: [
								react_jsx_runtime.jsx("span", { className: cssDefault.botSummaryName, children: app?.botName || "当前机器人" }),
								react_jsx_runtime.jsx("span", { className: cssDefault.botSummaryMeta, children: [app?.brand, app?.appIdSuffix ? `App …${app.appIdSuffix}` : state.legacyAppIdSuffix ? `App …${state.legacyAppIdSuffix}` : null].filter(Boolean).join(" · ") })
							] }),
							react_jsx_runtime.jsxs("span", { className: cssDefault.botSummaryAside, children: [
								react_jsx_runtime.jsx("span", { className: statusClass, children: connected ? "已连接" : "需要处理" })
							] })
						] }),
						react_jsx_runtime.jsxs("div", { className: cssDefault.actions, children: [
							react_jsx_runtime.jsx("button", { type: "button", className: cssDefault.secondary, disabled: onboardingBusy || !state.writable, onClick: () => setManagingLegacy(value => !value), children: managingLegacy ? "收起" : "更换或修复" })
						] })
					] }) : null,
					managingLegacy ? react_jsx_runtime.jsx(OnboardingPanel, {
						...props,
						writable: state.writable,
						cardDirty: props.cardDirty,
						onClose: () => setManagingLegacy(false)
					}) : null,
					state.error ? react_jsx_runtime.jsx("p", { className: cssDefault.onboardingError, children: state.error }) : null
				] });
			}
			const statuses = new Map((state.statuses ?? []).map(item => [item.id, item]));
			return react_jsx_runtime.jsxs("div", { className: cssDefault.botList, children: [
				react_jsx_runtime.jsxs("div", { className: cssDefault.botToolbar, children: [
					react_jsx_runtime.jsxs("div", { className: cssDefault.botIntro, children: [
						react_jsx_runtime.jsx("h3", { className: cssDefault.onboardingTitle, children: "机器人管理" }),
						react_jsx_runtime.jsx("p", { className: cssDefault.onboardingDesc, children: `已配置 ${state.bots.length} 个机器人。点击卡片可以展开并修改设置。` })
					] }),
					react_jsx_runtime.jsx("button", { type: "button", className: cssDefault.primary, disabled: state.saving || state.dirty || onboardingBusy || !state.writable, onClick: beginAdd, children: "添加机器人" })
				] }),
				addingBot ? react_jsx_runtime.jsx(OnboardingPanel, {
					...props,
					multiAdd: true,
					baselineRevision: addBaselineRevision,
					writable: state.writable,
					cardDirty: state.dirty,
					onboardingStart: (mode, destination) => { setAddStarted(true); props.onboardingStart(mode, destination); },
					onClose: () => { setAddingBot(false); setAddStarted(false); },
					onManual: () => { props.addBot(); setAddingBot(false); setAddStarted(false); }
				}) : null,
				...(state.bots ?? []).map((bot, index) => react_jsx_runtime.jsx(BotEditor, { bot, index, status: statuses.get(bot.id), disabled: state.saving || onboardingBusy || !state.writable, onEdit: (field, value) => props.editBot(index, field, value), onDelete: () => props.deleteBot(index) }, bot.id || bot.appId || `bot-${index}`)),
				react_jsx_runtime.jsxs("details", { className: cssDefault.botAdvanced, children: [
					react_jsx_runtime.jsx("summary", { className: cssDefault.botAdvancedSummary, children: "全局高级设置" }),
					react_jsx_runtime.jsxs("label", { className: cssDefault.field + " " + cssDefault.botLimit, children: [
						react_jsx_runtime.jsx("span", { className: cssDefault.label, children: "所有机器人同时运行的任务上限" }),
						react_jsx_runtime.jsx("input", { className: cssDefault.input, inputMode: "numeric", value: String(state.maxTotalLiveAgents ?? 0), disabled: state.saving || onboardingBusy || !state.writable, onChange: event => props.editMax(Number(event.target.value || 0)) }),
						react_jsx_runtime.jsx("span", { className: cssDefault.hint, children: "填写 0 表示不限制；一般保持 0 即可。" })
					] })
				] }),
				state.dirty && state.invalid ? react_jsx_runtime.jsx("p", { className: cssDefault.onboardingError, role: "alert", children: "还有必填项未完成，或某个数字/Workspace 设置无效；请展开标记为“待完成”的机器人检查。" }) : null,
				state.error ? react_jsx_runtime.jsx("p", { className: cssDefault.onboardingError, children: state.error }) : null,
				react_jsx_runtime.jsxs("div", { className: cssDefault.footer, children: [
					react_jsx_runtime.jsx("button", { type: "button", className: cssDefault.discard, disabled: !state.dirty || state.saving || onboardingBusy, onClick: props.discardBots, children: "取消修改" }),
					react_jsx_runtime.jsx("button", { type: "button", className: cssDefault.save, disabled: !state.dirty || state.invalid || state.saving || onboardingBusy || !state.writable, onClick: props.saveBots, children: state.saving ? "保存中…" : "保存更改" })
				] })
			] });
		}

		function OnboardingPanel(props) {
			const hook = props.usePersonalAgentOnboarding;
			if (hook === void 0) return null;
			const snapshot = hook((value) => value);
			const rawStatus = snapshot?.status;
			const staleMultiStatus = props.multiAdd && (rawStatus?.destination !== "new-bot"
				|| (rawStatus?.revision ?? -1) <= (props.baselineRevision ?? -1));
			const status = staleMultiStatus ? void 0 : rawStatus;
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
				props.onboardingStart("update", props.multiAdd ? "new-bot" : "legacy");
			};
			const statusClass = status?.connected
				? cssDefault.status + " " + cssDefault.statusReady
				: phase === "failed" || phase === "expired"
					? cssDefault.status + " " + cssDefault.statusFailed
					: active ? cssDefault.status + " " + cssDefault.statusBusy : cssDefault.status;
			const secondsLeft = status?.expiresAt === void 0
				? void 0
				: Math.max(0, Math.ceil((status.expiresAt - Date.now()) / 1000));
			const scanHintKey = status?.mode === "select" ? "onboarding.scanHintSelect"
				: status?.mode === "update" ? "onboarding.scanHintUpdate" : "onboarding.scanHintCreate";
			const titleKey = props.multiAdd ? "onboarding.multiTitle" : configured ? "onboarding.manageTitle" : "onboarding.title";
			const descriptionKey = props.multiAdd ? "onboarding.multiDescription" : configured ? "onboarding.manageDescription" : "onboarding.description";
			return react_jsx_runtime.jsxs("div", { className: cssDefault.onboarding, children: [
				react_jsx_runtime.jsxs("div", { className: cssDefault.onboardingHead, children: [
					react_jsx_runtime.jsxs("div", { children: [
						react_jsx_runtime.jsx("h3", { className: cssDefault.onboardingTitle, children: props.t(titleKey) }),
						react_jsx_runtime.jsx("p", { className: cssDefault.onboardingDesc, children: props.t(descriptionKey) })
					] }),
					react_jsx_runtime.jsx("span", { className: statusClass, role: "status", children: props.t(onboardingStatusKey(status)) })
				] }),
				status?.qrUrl ? react_jsx_runtime.jsxs("div", { className: cssDefault.qrWrap, children: [
					status.qrImageDataUrl
						? react_jsx_runtime.jsx("img", { className: cssDefault.qr, src: status.qrImageDataUrl, alt: props.t("onboarding.qrAlt") })
						: react_jsx_runtime.jsx("div", { className: cssDefault.qr, "aria-label": props.t("onboarding.qrRendering") }),
					react_jsx_runtime.jsxs("div", { className: cssDefault.qrHelp, children: [
						react_jsx_runtime.jsx("p", { className: cssDefault.onboardingMeta, children: props.t(scanHintKey) }),
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
						onClick: () => props.onboardingStart("select", props.multiAdd ? "new-bot" : "legacy"),
						children: props.t(configured ? "onboarding.selectOther" : "onboarding.select")
					}),
					react_jsx_runtime.jsx("button", {
						type: "button", className: cssDefault.secondary,
						disabled: blocked,
						onClick: () => props.onboardingStart("create", props.multiAdd ? "new-bot" : "legacy"),
						children: props.t(configured ? "onboarding.createAnother" : "onboarding.create")
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
					}) : null,
					props.multiAdd && !active && props.onManual ? react_jsx_runtime.jsx("button", {
						type: "button", className: cssDefault.secondary,
						disabled: acting || !writable || props.cardDirty === true,
						onClick: props.onManual,
						children: props.t("onboarding.manualAdd")
					}) : null,
					props.onClose ? react_jsx_runtime.jsx("button", {
						type: "button", className: cssDefault.secondary,
						disabled: active || acting,
						onClick: props.onClose,
						children: props.t(phase === "ready" ? "onboarding.done" : "onboarding.close")
					}) : null
				] }),
				react_jsx_runtime.jsx("p", { className: cssDefault.onboardingMeta, children: props.t(props.multiAdd ? "onboarding.multiHint" : "onboarding.manualHint") })
			] });
		}

		function LegacyAdvancedSettings(props) {
			const { t, state } = props;
			const disabled = !state.writable || props.active;
			const fieldProps = { disabled };
			const blocked = !state.dirty || state.invalid || state.saving || props.active;
			return react_jsx_runtime.jsxs("details", { className: cssDefault.botAdvanced, children: [
				react_jsx_runtime.jsx("summary", { className: cssDefault.botAdvancedSummary, children: "手动配置与高级设置" }),
				react_jsx_runtime.jsx("p", { className: cssDefault.onboardingDesc, children: "扫码连接的机器人通常无需修改这些字段。仅在使用自建应用、限制使用者或排查连接问题时展开。" }),
				...FIELD_GROUPS.map((group) => react_jsx_runtime.jsxs(react.Fragment, {
					key: group.key,
					children: [
						react_jsx_runtime.jsx("p", { className: props.page ? cssDefault.pageGroup : cssDefault.groupTitle, children: t(`g.${group.key}`) }),
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

		function FeishuRemoteSettingsCard(props) {
			const { t } = props;
			const state = props.useFeishuRemoteSettingsCard((snapshot) => snapshot);
			const onboarding = props.usePersonalAgentOnboarding?.((snapshot) => snapshot);
			const admin = props.useFeishuBotAdmin?.((snapshot) => snapshot);
			const multi = admin !== void 0 && admin.mode !== "legacy";
			const active = onboardingActive(onboarding?.status);
			return react_jsx_runtime.jsx(PluginSettingsCard, {
				t,
				titleKey: "settings.title",
				descriptionKey: "settings.description",
				state: { ...state, invalid: state.invalid || active },
				onSave: active ? () => {} : props.save,
				onDiscard: props.discard,
				hideFooter: true,
				children: [
					react_jsx_runtime.jsx(MultiBotPanel, { ...props, key: "multi", cardDirty: state.dirty }),
					multi ? null : react_jsx_runtime.jsx(LegacyAdvancedSettings, { ...props, key: "advanced", t, state, active })
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
			const admin = props.useFeishuBotAdmin?.((snapshot) => snapshot);
			const multi = admin !== void 0 && admin.mode !== "legacy";
			const active = onboardingActive(onboarding?.status);
			return react_jsx_runtime.jsxs("div", { className: cssDefault.page, children: [
				react_jsx_runtime.jsxs("div", { className: cssDefault.pageHead, children: [
					react_jsx_runtime.jsx("h2", { className: cssDefault.pageTitle, children: t("settings.title") }),
					react_jsx_runtime.jsx("p", { className: cssDefault.pageDesc, children: t("settings.description") }),
					state.dirty ? react_jsx_runtime.jsx("span", { className: cssDefault.pending, children: t("settings.unsaved") }) : null,
					!state.writable ? react_jsx_runtime.jsx("p", { className: cssDefault.readOnly, role: "status", children: t("settings.readOnly") }) : null
				] }),
				react_jsx_runtime.jsx(MultiBotPanel, { ...props, key: "multi", cardDirty: state.dirty }),
				multi ? null : react_jsx_runtime.jsx(LegacyAdvancedSettings, { ...props, key: "advanced", t, state, active, page: true })
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

		var FeishuBotAdminController = class {
			constructor(connection) {
				this.connection = connection;
				this.snapshot = { loaded: false, writable: false, mode: "loading", revision: 0, bots: [], statuses: [], legacyConfigured: false, legacyAppIdSuffix: "", maxTotalLiveAgents: 0, dirty: false, invalid: false, saving: false, error: void 0 };
				this.store = runtime.createSnapshotStore(this.snapshot);
				this.stopped = true;
				this.timer = void 0;
				this.original = void 0;
			}
			publish(patch) {
				this.snapshot = { ...this.snapshot, ...patch };
				this.store.set(this.snapshot);
			}
			async request(endpoint, payload = {}) {
				const result = await this.connection.rpc.call("/dsh-feishu-remote", endpoint, payload);
				if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code, details: result.error.details });
				return result.value;
			}
			invalid(bots, max) {
				if (!Number.isSafeInteger(max) || max < 0) return true;
				if (this.snapshot.mode === "multi" && bots.length === 0) return true;
				const ids = new Set();
				const apps = new Set();
				for (const bot of bots) {
					if (!/^[a-z][a-z0-9-]{0,47}$/.test(bot.id ?? "") || !bot.appId || !bot.appSecretRef) return true;
					if (ids.has(bot.id) || apps.has(bot.appId)) return true;
					if (bot.workspacePolicy === "locked" && !bot.defaultWorkspace) return true;
					if (!Number.isSafeInteger(bot.maxLiveAgents ?? 0) || (bot.maxLiveAgents ?? 0) < 0) return true;
					ids.add(bot.id); apps.add(bot.appId);
				}
				return false;
			}
			stage(bots, max = this.snapshot.maxTotalLiveAgents) {
				this.publish({ bots, maxTotalLiveAgents: max, dirty: true, invalid: this.invalid(bots, max), error: void 0 });
			}
			async refresh(force = false) {
				if (this.stopped || this.connection.isLoopback === false) return;
				try {
					const [editor, runtimeStatus] = await Promise.all([this.request("settings/editor-snapshot"), this.request("bots/status")]);
					if (!this.snapshot.dirty || force) {
						const bots = structuredClone(editor.config.bots ?? []);
						const legacyAppId = typeof editor.config.appId === "string" ? editor.config.appId.trim() : "";
						this.original = { bots: structuredClone(bots), maxTotalLiveAgents: editor.config.maxTotalLiveAgents ?? 0 };
						this.publish({ loaded: true, writable: editor.writable, mode: editor.mode, revision: editor.revision, bots, legacyConfigured: editor.mode === "legacy" && legacyAppId !== "", legacyAppIdSuffix: legacyAppId.slice(-6), maxTotalLiveAgents: editor.config.maxTotalLiveAgents ?? 0, statuses: runtimeStatus.bots ?? [], dirty: false, invalid: false, error: void 0 });
					} else {
						this.publish({ statuses: runtimeStatus.bots ?? [] });
					}
				} catch (error) {
					this.publish({
						loaded: true,
						...(this.snapshot.mode === "loading" ? { mode: "unavailable", writable: false } : {}),
						error: error instanceof Error ? error.message : String(error)
					});
				}
			}
			mount() {
				this.stopped = false;
				if (this.connection.isLoopback === false) {
					this.publish({ loaded: true, writable: false, mode: "unavailable", error: "机器人管理只允许 Host 本机 loopback 页面；legacy 字段不会在此远程页面显示或保存。" });
					return () => { this.stopped = true; };
				}
				const tick = async () => { await this.refresh(false); if (!this.stopped) this.timer = setTimeout(tick, 2500); };
				void tick();
				return () => { this.stopped = true; if (this.timer !== void 0) clearTimeout(this.timer); };
			}
			async convertLegacy() {
				if (this.snapshot.saving || !this.snapshot.writable) return false;
				this.publish({ saving: true, error: void 0 });
				try { await this.request("settings/convert-legacy"); await this.refresh(true); return true; }
				catch (error) { this.publish({ error: error instanceof Error ? error.message : String(error) }); return false; }
				finally { this.publish({ saving: false }); }
			}
			async save() {
				if (!this.snapshot.dirty || this.snapshot.invalid || this.snapshot.saving) return;
				this.publish({ saving: true, error: void 0 });
				try {
					const bots = this.snapshot.bots.map(serializeBotDraft);
					await this.request("settings/save-bots", { revision: this.snapshot.revision, bots, maxTotalLiveAgents: this.snapshot.maxTotalLiveAgents });
					await this.refresh(true);
				} catch (error) {
					const latest = error?.details?.latest;
					this.publish({
						...(latest?.revision === void 0 ? {} : { revision: latest.revision, writable: latest.writable }),
						error: error instanceof Error ? error.message : String(error)
					});
				} finally {
					this.publish({ saving: false });
				}
			}
			discard() {
				if (this.original === void 0) return;
				const bots = structuredClone(this.original.bots);
				this.publish({ bots, maxTotalLiveAgents: this.original.maxTotalLiveAgents, dirty: false, invalid: false, error: void 0 });
			}
			inject() {
				return {
					hooks: { feishuBotAdmin: this.store },
					convertLegacy: () => this.convertLegacy(),
					refreshBots: () => this.refresh(true),
					addBot: () => {
						const used = new Set(this.snapshot.bots.map(bot => bot.id));
						let number = this.snapshot.bots.length + 1;
						while (used.has(`bot-${number}`)) number += 1;
						this.stage([...this.snapshot.bots, { id: `bot-${number}`, enabled: true, appId: "", appSecretRef: "", brand: "feishu", allowedOpenIds: "", allowedChatIds: "", allowAllUsers: false, requireMention: true, defaultWorkspace: "", workspacePolicy: "default", profileFile: "", agentPreset: "", provider: "", model: "", maxLiveAgents: 0, contextMode: "auto", contextBackend: "sdk", sessionNamespace: "app" }]);
					},
					deleteBot: index => this.stage(this.snapshot.bots.filter((_bot, item) => item !== index)),
					editBot: (index, field, value) => this.stage(this.snapshot.bots.map((bot, item) => item === index ? { ...bot, [field]: value } : bot)),
					editMax: value => this.stage(this.snapshot.bots, value),
					saveBots: () => this.save(),
					discardBots: () => this.discard()
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
					onboardingStart: (mode, destination = "legacy") => this.invoke("onboarding/start", { mode, destination }),
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
			"settings.navLabel": "Feishu Remote",
			"settings.description": "Control the running DeepSeek Harness from a Feishu bot — thread-per-session, approval cards, fail-closed sender allowlist.",
			"settings.expand": "Expand", "settings.collapse": "Collapse", "settings.unsaved": "Unsaved changes",
			"settings.readOnly": "This deployment is read-only: settings cannot be changed from the GUI.",
			"settings.overridden": "Override", "settings.reset": "Reset", "settings.invalidNumber": "Enter a valid number",
			"settings.discard": "Discard", "settings.save": "Save", "settings.saving": "Saving…", "settings.saveFailed": "Save failed",
			"onboarding.title": "Connect a Feishu bot",
			"onboarding.description": "Choose an existing PersonalAgent you own, or create a new one. A Feishu/Lark scan securely saves its credentials on this Host and connects it without developer-console setup.",
			"onboarding.manageTitle": "Manage current bot",
			"onboarding.manageDescription": "Reconnect, replace, or repair permissions for this bot. Replacing it does not add another bot.",
			"onboarding.multiTitle": "Add a bot",
			"onboarding.multiDescription": "Scan to choose an existing PersonalAgent or create a new one. App ID, secret storage, owner access, and connection are configured automatically.",
			"onboarding.select": "Select an existing bot", "onboarding.selectOther": "Replace with an existing bot",
			"onboarding.create": "Create a new bot", "onboarding.createAnother": "Create a new bot and replace", "onboarding.grant": "Grant missing permissions",
			"onboarding.retry": "Retry connection", "onboarding.cancel": "Cancel", "onboarding.qrAlt": "Feishu PersonalAgent authorization QR code",
			"onboarding.manualAdd": "Manual setup (advanced)", "onboarding.done": "Done", "onboarding.close": "Close",
			"onboarding.qrRendering": "Rendering QR code",
			"onboarding.scanHintCreate": "Scan with Feishu/Lark, review the permissions, then confirm creation of a new bot.",
			"onboarding.scanHintSelect": "Scan with Feishu/Lark, choose a PersonalAgent you already own, review the permissions, then confirm binding.",
			"onboarding.scanHintUpdate": "Scan with Feishu/Lark, review the permission changes for this bot, then confirm.",
			"onboarding.expiresIn": "Expires in", "onboarding.openLink": "Open the authorization link on this device",
			"onboarding.manualHint": "If the plugin is reinstalled and its saved settings are still present, it reconnects automatically. Otherwise choose the existing bot here; advanced fields below also support manually-created apps.",
			"onboarding.multiHint": "Recommended: scan to add the bot. Manual setup is intended only for apps whose credentials are already managed separately.",
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
			"f.defaultWorkspace": "Default Workspace", "f.defaultWorkspaceHint": "Workspace ID or absolute path used only for a source without an existing binding.",
			"f.workspacePolicy": "Workspace policy", "f.workspacePolicyHint": "default keeps existing bindings; locked forces every source to the configured default Workspace.",
			"f.profileFile": "Bot Profile Markdown", "f.profileFileHint": "Trusted local UTF-8 Markdown (max 32 KiB) injected into every Agent system prompt. Never put secrets here.",
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
			"settings.navLabel": "飞书遥控",
			"settings.description": "用飞书机器人操控正在运行的 DeepSeek Harness：话题级会话、审批卡片、fail-closed 发送者白名单。",
			"settings.expand": "展开", "settings.collapse": "收起", "settings.unsaved": "有未保存的修改",
			"settings.readOnly": "当前部署为只读：GUI 无法修改设置。",
			"settings.overridden": "已覆盖", "settings.reset": "重置", "settings.invalidNumber": "请输入有效数字",
			"settings.discard": "放弃", "settings.save": "保存", "settings.saving": "保存中…", "settings.saveFailed": "保存失败",
			"onboarding.title": "连接飞书机器人",
			"onboarding.description": "可以选择你已经创建的 PersonalAgent，也可以新建一个。扫码后会在本机安全保存凭据并连接，无需进入开发者后台。",
			"onboarding.manageTitle": "管理当前机器人",
			"onboarding.manageDescription": "可重新连接、更换机器人或修复权限；这里的操作会替换当前机器人，不会新增机器人。",
			"onboarding.multiTitle": "添加机器人",
			"onboarding.multiDescription": "扫码选择已有 PersonalAgent，或者创建一个新的。App ID、Secret 安全存储、使用者权限和长连接都会自动配置。",
			"onboarding.select": "选择并绑定已有机器人", "onboarding.selectOther": "更换为已有机器人",
			"onboarding.create": "创建并绑定新机器人", "onboarding.createAnother": "创建新机器人并替换", "onboarding.grant": "补开缺失权限",
			"onboarding.retry": "重试连接", "onboarding.cancel": "取消", "onboarding.qrAlt": "飞书 PersonalAgent 授权二维码",
			"onboarding.manualAdd": "手动配置（高级）", "onboarding.done": "完成", "onboarding.close": "关闭",
			"onboarding.qrRendering": "正在生成二维码",
			"onboarding.scanHintCreate": "请用手机飞书/Lark 扫码，核对权限清单后确认创建新机器人。",
			"onboarding.scanHintSelect": "请用手机飞书/Lark 扫码，选择你已经创建的机器人，核对权限后确认绑定。",
			"onboarding.scanHintUpdate": "请用手机飞书/Lark 扫码，核对这个机器人的权限变更后确认。",
			"onboarding.expiresIn": "剩余", "onboarding.openLink": "在本机打开授权链接",
			"onboarding.manualHint": "重新安装插件后，若原设置仍在会自动重连；若设置已丢失，可在这里重新选择已有机器人。下方高级字段也支持手工自建应用。",
			"onboarding.multiHint": "推荐直接扫码添加；只有凭据已经由你单独管理的自建应用，才需要手动配置。",
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
			"f.defaultWorkspace": "默认 Workspace", "f.defaultWorkspaceHint": "Workspace ID 或绝对路径；只为尚未绑定的来源提供默认值。",
			"f.workspacePolicy": "Workspace 策略", "f.workspacePolicyHint": "default 保留已有绑定；locked 强制所有来源使用默认 Workspace。",
			"f.profileFile": "机器人 Profile Markdown", "f.profileFileHint": "本机可信 UTF-8 Markdown（最大 32 KiB），注入每个 Agent 的 system prompt；禁止放入凭据。",
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
				"p.defaultWorkspace": "Example: /Users/you/Projects/curio",
				"p.profileFile": "Example: /Users/you/.dsh/bot-profiles/curio.md",
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
				"p.defaultWorkspace": "例如：/Users/you/Projects/curio",
				"p.profileFile": "例如：/Users/you/.dsh/bot-profiles/curio.md",
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
				const botAdminController = new FeishuBotAdminController(ctx.connection);
				ctx.effect(() => onboardingController.mount(), "dsh-feishu-remote: PersonalAgent onboarding polling");
				ctx.effect(() => botAdminController.mount(), "dsh-feishu-remote: multi-bot admin polling");
				const injection = () => {
					const settings = settingsController.inject();
					const onboarding = onboardingController.inject();
					const bots = botAdminController.inject();
					return {
						...settings,
						...onboarding,
						...bots,
						hooks: { ...settings.hooks, ...onboarding.hooks, ...bots.hooks }
					};
				};
				// 两处 slot 注册各自独立 try/catch（docs/11 防线）：任何一处契约失效
				// 都只影响它自己的入口，既不连累另一处，也不拖垮宿主界面。
				try {
					ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
						name: "settings.plugin.item",
						key: SETTINGS_NS,
						locale: NS,
						inject: injection
					}, FeishuRemoteSettingsCard));
				} catch (error) {
					console.error("[dsh-feishu-remote] slot \"settings.plugin.item\" 注册失败（折叠卡片不显示，不影响设置页分区与宿主界面）：", error);
				}
				// 设置页顶层分区（左侧栏独立一项，与「文件提及」同级）
				try {
					const t = ctx.locale.bind(NS);
					ctx.slots.inject("settings.section", () => ctx.slots.register({
						name: "settings.section",
						id: "feishu-remote",
						order: 18,
						// 左栏导航用短标签，避免 800px 设置弹窗把长标题截成「飞书遥控（dsh-…」。
						label: () => t("settings.navLabel"),
						locale: NS,
						inject: injection
					}, FeishuRemoteSection));
				} catch (error) {
					console.error("[dsh-feishu-remote] slot \"settings.section\" 注册失败（左栏分区不显示，不影响折叠卡片与宿主界面）：", error);
				}
			} catch (error) {
				console.error("[dsh-feishu-remote] 设置卡注册失败（卡片将不显示，宿主界面不受影响）：", error);
			}
		}
		exports.apply = apply;
		exports.botPresentation = botPresentation;
		exports.inject = inject;
		exports.serializeBotDraft = serializeBotDraft;
		exports.splitLegacyFeishuMessageText = splitLegacyFeishuMessageText;
		return module.exports;
	}
});

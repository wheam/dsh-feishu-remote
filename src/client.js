// dsh-feishu-remote — browser (client) half: the「飞书遥控」settings page.
//
// A hand-written ModuleLoader module (no build step; shipped at ./client and
// copied verbatim to lib/client.js). One mental model only (docs/18 §1):
// 机器人列表 → 机器人详情. The `settings.section` page owns the whole UI; the
// `settings.plugin.item` card is a read-only summary.
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
		// dsh 0.1.2 exposes the store as a platform module; older hosts export it
		// from client-runtime. Keep both hosts supported during upgrades.
		let runtime;
		try { runtime = require("@deepseek-ai/dsh-client-store"); } catch {}
		if (typeof runtime?.createSnapshotStore !== "function") {
			runtime = require("@deepseek-ai/dsh-client-runtime/client");
		}

		// ---------------------------------------------------------------- css
		// Colours come from host alias tokens only (light/dark safe). The single
		// literal is the QR quiet zone, which must stay white in both themes.
		const baseCss = ".fr_page{display:flex;flex-direction:column;gap:14px;max-width:560px;padding-bottom:2px}"
			+ ".fr_head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}"
			+ ".fr_headText{display:flex;flex-direction:column;gap:4px;min-width:0}"
			+ ".fr_h1{margin:0;font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary)}"
			+ ".fr_intro{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}"
			+ ".fr_card{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}"
			+ ".fr_addRow{display:flex;align-items:center;gap:8px;width:100%;padding:11px 16px;border:0;border-top:1px solid var(--dsw-alias-border-l1);background:transparent;font:inherit;font-size:13px;color:var(--dsw-alias-state-business-primary);cursor:pointer;text-align:left}"
			+ ".fr_addRow:first-child{border-top:0}"
			+ ".fr_addRow:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}"
			+ ".fr_addRow:disabled{opacity:.5;cursor:default}"
			+ ".fr_addPlus{font-size:15px;line-height:1}"
			+ ".fr_secTitle{margin:6px 0 -6px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}"
			+ ".fr_note{margin:0;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}"
			+ ".fr_error{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary)}"
			+ ".fr_raw{margin:2px 0 0;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-tertiary)}"
			+ ".fr_notice{margin:4px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-state-warn-primary)}"
			+ ".fr_blocked{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}";
		const listCss = ".fr_row{display:grid;grid-template-columns:36px minmax(0,1fr) auto auto;align-items:center;gap:12px;width:100%;padding:12px 14px;border:0;border-top:1px solid var(--dsw-alias-border-l2);background:0 0;font:inherit;text-align:left;color:var(--dsw-alias-label-primary);cursor:pointer}"
			+ ".fr_row:first-child{border-top:0}"
			+ ".fr_row:hover{background:var(--dsw-alias-interactive-bg-hover)}"
			+ ".fr_row:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}"
			+ ".fr_rowOff{opacity:.62}"
			+ ".fr_avatar{width:36px;height:36px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-state-business-primary)}"
			+ ".fr_avatarLg{width:42px;height:42px;border-radius:11px;font-size:16px}"
			+ ".fr_rowText{display:flex;flex-direction:column;gap:3px;min-width:0}"
			+ ".fr_rowTitle{display:flex;align-items:center;gap:8px;min-width:0}"
			+ ".fr_name{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"
			+ ".fr_nameLg{font-size:15px;font-weight:600}"
			+ ".fr_pill{border-radius:999px;padding:1px 7px;font-size:11px;white-space:nowrap;background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-label-secondary)}"
			+ ".fr_sub{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"
			+ ".fr_state{display:flex;align-items:center;gap:6px;font-size:11px;white-space:nowrap;color:var(--dsw-alias-label-secondary)}"
			+ ".fr_dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;background:var(--dsw-alias-label-dimmed)}"
			+ ".fr_dotOk{background:var(--dsw-alias-state-success-primary)}"
			+ ".fr_dotWarn{background:var(--dsw-alias-state-warn-primary)}"
			+ ".fr_dotErr{background:var(--dsw-alias-state-error-primary)}"
			+ ".fr_toneOk{color:var(--dsw-alias-state-success-primary)}"
			+ ".fr_toneWarn{color:var(--dsw-alias-state-warn-primary)}"
			+ ".fr_toneErr{color:var(--dsw-alias-state-error-primary)}"
			+ ".fr_chev{color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:1}";
		const formCss = ".fr_setting{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:12px 14px;border-top:1px solid var(--dsw-alias-border-l2)}"
			+ ".fr_setting:first-child{border-top:0}"
			+ ".fr_settingCol{flex-direction:column;align-items:stretch;gap:10px}"
			+ ".fr_settingText{display:flex;flex-direction:column;gap:3px;min-width:0}"
			+ ".fr_label{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}"
			+ ".fr_labelDanger{color:var(--dsw-alias-state-error-primary)}"
			+ ".fr_hint{margin:0;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}"
			+ ".fr_fieldError{margin:2px 0 0;font-size:11px;line-height:1.5;color:var(--dsw-alias-state-error-primary)}"
			+ ".fr_ctl{display:flex;align-items:center;gap:8px;flex-shrink:0}"
			+ ".fr_input{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:5px 8px;min-height:30px;width:228px;box-sizing:border-box}"
			+ ".fr_inputSm{width:80px}"
			+ ".fr_input:disabled{opacity:.6}"
			+ ".fr_input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}"
			+ ".fr_toggle{position:relative;width:34px;height:20px;padding:0;border:0;border-radius:999px;flex-shrink:0;cursor:pointer;background:var(--dsw-alias-label-dimmed)}"
			+ ".fr_toggle:after{content:\"\";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground);transition:left .12s}"
			+ ".fr_toggleOn{background:var(--dsw-alias-button-info-fill)}"
			+ ".fr_toggleOn:after{left:16px}"
			+ ".fr_toggleDanger.fr_toggleOn{background:var(--dsw-alias-state-error-primary)}"
			+ ".fr_toggle:disabled{opacity:.5;cursor:default}"
			+ ".fr_chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px;width:100%}"
			+ ".fr_chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:2px 6px;font-size:11px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}"
			+ ".fr_chipX{background:0 0;border:0;padding:0;font:inherit;line-height:1;cursor:pointer;color:var(--dsw-alias-label-tertiary)}"
			+ ".fr_chipX:hover:not(:disabled){color:var(--dsw-alias-state-error-primary)}"
			+ ".fr_chipInput{border:1px dashed var(--dsw-alias-border-l2);border-radius:6px;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;padding:3px 7px;min-width:180px;flex:1}"
			+ ".fr_advanced{border:0;padding:0;margin:0}"
			+ ".fr_advancedSummary{cursor:pointer;list-style:none;padding:12px 14px;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary);display:flex;align-items:center;justify-content:space-between;gap:8px}"
			+ ".fr_advancedSummary::-webkit-details-marker{display:none}"
			+ ".fr_advancedSummary:after{content:'\\203A';color:var(--dsw-alias-label-tertiary);font-size:15px;transition:transform .12s}"
			+ "details[open]>.fr_advancedSummary:after{transform:rotate(90deg)}"
			+ ".fr_saveBar{position:sticky;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;margin-top:2px;background:var(--dsw-alias-bg-layer-2);border-top:1px solid var(--dsw-alias-border-l2)}"
			+ ".fr_saveCount{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-state-warn-primary)}"
			+ ".fr_crumbs{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-tertiary)}"
			+ ".fr_detailHead{display:flex;align-items:center;justify-content:space-between;gap:16px}"
			+ ".fr_identity{display:flex;align-items:center;gap:12px;min-width:0}";
		const buttonCss = ".fr_primary,.fr_secondary,.fr_danger,.fr_link{font:inherit;cursor:pointer}"
			+ ".fr_primary,.fr_secondary,.fr_danger{border-radius:6px;padding:6px 12px;font-size:12px;min-height:30px;white-space:nowrap}"
			+ ".fr_primary{border:1px solid var(--dsw-alias-button-info-fill);background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-label-primary-foreground)}"
			+ ".fr_primary:hover:not(:disabled){border-color:var(--dsw-alias-button-info-hover);background:var(--dsw-alias-button-info-hover)}"
			+ ".fr_secondary{border:1px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-primary)}"
			+ ".fr_secondary:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed)}"
			+ ".fr_danger{border:1px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-state-error-primary)}"
			+ ".fr_primary:disabled,.fr_secondary:disabled,.fr_danger:disabled{opacity:.5;cursor:default}"
			+ ".fr_link{border:0;background:0 0;padding:0;font-size:11px;color:var(--dsw-alias-state-business-primary)}"
			+ ".fr_link:hover{text-decoration:underline}";
		const onboardingCss = ".fr_onboarding{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);padding:16px;display:flex;flex-direction:column;gap:12px}"
			+ ".fr_onboardingHead{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}"
			+ ".fr_onboardingTitle{margin:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}"
			+ ".fr_onboardingDesc,.fr_onboardingMeta{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}"
			+ ".fr_onboardingMeta{font-size:11px;color:var(--dsw-alias-label-tertiary)}"
			+ ".fr_status{border-radius:999px;padding:2px 8px;font-size:11px;white-space:nowrap;background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-label-secondary)}"
			+ ".fr_statusReady{color:var(--dsw-alias-state-success-primary)}"
			+ ".fr_statusBusy{color:var(--dsw-alias-state-warn-primary)}"
			+ ".fr_statusFailed{color:var(--dsw-alias-state-error-primary)}"
			+ ".fr_qrWrap{display:flex;flex-wrap:wrap;align-items:center;gap:16px}"
			+ ".fr_qr{width:184px;height:184px;object-fit:contain;background:#fff;border-radius:8px;padding:8px}"
			+ ".fr_qrHelp{display:flex;flex-direction:column;gap:6px;flex:1;min-width:200px}"
			+ ".fr_actions{display:flex;flex-wrap:wrap;gap:8px}"
			+ ".fr_capabilities{display:flex;flex-wrap:wrap;gap:6px}"
			+ ".fr_capability{border-radius:999px;padding:2px 7px;font-size:11px;background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-label-secondary)}";
		const summaryCss = ".fr_summary{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:8px;list-style:none;padding:12px 14px;display:flex;flex-direction:column;gap:6px}"
			+ ".fr_summaryName{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}"
			+ ".fr_summaryDesc{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}"
			+ ".fr_summaryDots{display:flex;flex-wrap:wrap;gap:10px;font-size:11px;color:var(--dsw-alias-label-secondary)}"
			+ ".fr_summaryDot{display:flex;align-items:center;gap:5px;min-width:0}";
		const readabilityCss = ".fr_label,.fr_name,.fr_nameLg{display:block;opacity:1;visibility:visible}"
			+ ".fr_hint{color:var(--dsw-alias-label-secondary)!important;line-height:1.5}"
			+ ".fr_input::placeholder,.fr_chipInput::placeholder{color:var(--dsw-alias-label-tertiary);opacity:1}";
		const css = baseCss + listCss + formCss + buttonCss + onboardingCss + summaryCss + readabilityCss;
		const tagId = "dsh-feishu-remote/settings-card.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-feishu-remote";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		const cx = {
			page: "fr_page", head: "fr_head", headText: "fr_headText", h1: "fr_h1", intro: "fr_intro",
			card: "fr_card", addRow: "fr_addRow", addPlus: "fr_addPlus", secTitle: "fr_secTitle", note: "fr_note", error: "fr_error",
			raw: "fr_raw", notice: "fr_notice", blocked: "fr_blocked",
			row: "fr_row", rowOff: "fr_rowOff", avatar: "fr_avatar", avatarLg: "fr_avatarLg",
			rowText: "fr_rowText", rowTitle: "fr_rowTitle", name: "fr_name", nameLg: "fr_nameLg",
			pill: "fr_pill", sub: "fr_sub", state: "fr_state", dot: "fr_dot", chev: "fr_chev",
			setting: "fr_setting", settingCol: "fr_settingCol", settingText: "fr_settingText",
			label: "fr_label", labelDanger: "fr_labelDanger", hint: "fr_hint", fieldError: "fr_fieldError",
			ctl: "fr_ctl", input: "fr_input", inputSm: "fr_inputSm",
			toggle: "fr_toggle", toggleOn: "fr_toggleOn", toggleDanger: "fr_toggleDanger",
			chips: "fr_chips", chip: "fr_chip", chipX: "fr_chipX", chipInput: "fr_chipInput",
			advanced: "fr_advanced", advancedSummary: "fr_advancedSummary",
			saveBar: "fr_saveBar", saveCount: "fr_saveCount", crumbs: "fr_crumbs",
			detailHead: "fr_detailHead", identity: "fr_identity",
			primary: "fr_primary", secondary: "fr_secondary", danger: "fr_danger", link: "fr_link",
			onboarding: "fr_onboarding", onboardingHead: "fr_onboardingHead", onboardingTitle: "fr_onboardingTitle",
			onboardingDesc: "fr_onboardingDesc", onboardingMeta: "fr_onboardingMeta",
			status: "fr_status", statusReady: "fr_statusReady", statusBusy: "fr_statusBusy", statusFailed: "fr_statusFailed",
			qrWrap: "fr_qrWrap", qr: "fr_qr", qrHelp: "fr_qrHelp", actions: "fr_actions",
			capabilities: "fr_capabilities", capability: "fr_capability",
			summary: "fr_summary", summaryName: "fr_summaryName", summaryDesc: "fr_summaryDesc",
			summaryDots: "fr_summaryDots", summaryDot: "fr_summaryDot"
		};

		// -------------------------------------------------------------- jsx-runtime
		/** Tiny wrapper over the automatic jsx runtime (this module ships without JSX). */
		function h(type, props, children, key) {
			if (children === void 0) return react_jsx_runtime.jsx(type, props ?? {}, key);
			const list = (Array.isArray(children) ? children : [children])
				.filter((item) => item !== null && item !== void 0 && item !== false);
			if (list.length === 0) return react_jsx_runtime.jsx(type, { ...props }, key);
			if (list.length === 1) return react_jsx_runtime.jsx(type, { ...props, children: list[0] }, key);
			return react_jsx_runtime.jsxs(type, { ...props, children: list }, key);
		}
		/** Translate + interpolate `{name}` placeholders (the host `t` takes no params). */
		function tp(t, key, params) {
			let text = t(key);
			if (params === void 0) return text;
			for (const name of Object.keys(params)) text = text.split("{" + name + "}").join(String(params[name]));
			return text;
		}

		// ------------------------------------------------------- pure model layer
		// Everything below is deliberately free of react/DOM so tests can assert on
		// behaviour instead of on source strings (docs/18 §3.3).

		/** Per-bot keys the GUI owns. `id` rides along so the Host can merge by bot. */
		const BOT_DRAFT_KEYS = [
			"id", "enabled", "appId", "appSecretRef", "brand", "allowedChatIds", "requireMention",
			"defaultWorkspace", "workspacePolicy", "agentPreset",
			"profileFile", "provider", "model", "maxLiveAgents", "contextMode"
		];
		/**
		 * Root fields a single-bot save may touch. Subset of admin.ts
		 * EDITABLE_LEGACY_KEY_LIST; `id`/`enabled` have no root counterpart.
		 */
		const LEGACY_DRAFT_KEYS = BOT_DRAFT_KEYS.filter((key) => key !== "id" && key !== "enabled");
		const LIST_KEYS = ["allowedChatIds"];
		const LEGACY_ROW_ID = "legacy";

		function str(value) {
			return typeof value === "string" ? value : "";
		}
		function toList(value) {
			if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
			if (typeof value !== "string") return [];
			return value.split(/[\s,]+/).filter(Boolean);
		}
		/**
		 * Last line of defence for any text the Host supplies (docs/18 §2.4): the
		 * structured `detail`/`message` are meant to be safe already, but the GUI
		 * still redacts implementation vocabulary and filesystem paths so nothing
		 * a user cannot act on ever reaches the screen.
		 */
		// ASCII vocabulary is matched as WHOLE words only: 「wireless」 is an ordinary
		// word and must survive, while a bare 「wire」 is implementation vocabulary.
		const BANNED_OUTPUT_WORDS = /\b(?:legacy|namespace|loopback|revision|wire)\b/giu;
		// CJK has no word boundaries, so these stay substring matches.
		const BANNED_OUTPUT_TERMS = [/主机器人/gu, /凭据引用/gu, /内部名称/gu];
		// A web link is something the user can follow, not a local path. Only
		// http(s) is exempt: `file://…` IS a local path and stays redacted.
		const OUTPUT_URL_PATTERN = /https?:\/\/[^\s]+/giu;
		function safeText(value) {
			if (typeof value !== "string") return void 0;
			let text = value.trim();
			if (text === "") return void 0;
			// URLs are parked while filesystem paths are redacted, so the `/help` in
			// `https://example.com/help` is never mistaken for a local path.
			const urls = [];
			text = text.replace(/\u0000/gu, "");
			text = text.replace(OUTPUT_URL_PATTERN, (match) => {
				urls.push(match);
				return "\u0000" + (urls.length - 1) + "\u0000";
			});
			text = text.replace(/[A-Za-z]:\\[^\s]+/gu, "…").replace(/(?:\/[\w.@-]+){2,}\/?/gu, "…");
			text = text.replace(BANNED_OUTPUT_WORDS, "…");
			for (const pattern of BANNED_OUTPUT_TERMS) text = text.replace(pattern, "…");
			// Parked URLs come back LAST, after every path AND vocabulary pass, so a
			// link whose host or path merely contains an ordinary banned word — say
			// `https://wire.example.com/revision/12` — stays intact and followable.
			text = text.replace(/\u0000(\d+)\u0000/gu, (_match, index) => urls[Number(index)] ?? "");
			text = text.replace(/…{2,}/gu, "…").replace(/\s{2,}/gu, " ").trim();
			return text === "" || text === "…" ? void 0 : text;
		}

		function toCount(value) {
			const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
			return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
		}
		function sameValue(left, right) {
			if (Array.isArray(left) || Array.isArray(right)) {
				const a = toList(left);
				const b = toList(right);
				return a.length === b.length && a.every((item, index) => item === b[index]);
			}
			return left === right;
		}

		/** One editable bot row, whatever its on-disk shape (flat root or bots[]). */
		function normalizeBotRow(raw) {
			const bot = raw ?? {};
			return {
				id: str(bot.id),
				enabled: bot.enabled !== false,
				appId: str(bot.appId).trim(),
				appSecretRef: str(bot.appSecretRef).trim(),
				brand: bot.brand === "lark" || bot.brand === "larkoffice" ? bot.brand : "feishu",
				allowedChatIds: toList(bot.allowedChatIds),
				requireMention: bot.requireMention !== false,
				defaultWorkspace: str(bot.defaultWorkspace),
				workspacePolicy: bot.workspacePolicy === "locked" ? "locked" : "default",
				agentPreset: str(bot.agentPreset),
				profileFile: str(bot.profileFile),
				provider: str(bot.provider),
				model: str(bot.model),
				maxLiveAgents: toCount(bot.maxLiveAgents),
				contextMode: bot.contextMode === "off" ? "off" : "auto"
			};
		}

		/**
		 * A single-bot (flat root) config projected as ONE row. The projection is
		 * display-only: saving it goes back to the root fields through
		 * `settings/save-legacy`, never through a shape conversion (docs/17 §10.3).
		 */
		function projectLegacyRow(config) {
			return { ...normalizeBotRow(config), id: LEGACY_ROW_ID, enabled: true };
		}

		function botRowsFrom(snapshot) {
			if (snapshot === void 0) return [];
			if (snapshot.mode !== "legacy") return (snapshot.config?.bots ?? []).map(normalizeBotRow);
			const row = projectLegacyRow(snapshot.config);
			// A single-bot config with no App ID is not a bot yet — the page shows
			// the scan card instead of a row that can only say「待完成」.
			return row.appId === "" ? [] : [row];
		}

		/** Field keys whose draft value differs from the loaded one. */
		function changedBotKeys(original, draft) {
			if (original === void 0) return BOT_DRAFT_KEYS.filter((key) => key !== "id");
			return BOT_DRAFT_KEYS.filter((key) => key !== "id" && !sameValue(original[key], draft[key]));
		}

		function draftChangeCount(originals, drafts, originalMax, max) {
			const byId = new Map((originals ?? []).map((bot) => [bot.id, bot]));
			let count = originalMax === max ? 0 : 1;
			const seen = new Set();
			for (const draft of drafts ?? []) {
				seen.add(draft.id);
				count += changedBotKeys(byId.get(draft.id), draft).length;
			}
			for (const original of originals ?? []) if (!seen.has(original.id)) count += 1;
			return count;
		}

		/**
		 * Replay the pending draft onto a NEWER snapshot after a CAS conflict.
		 * `previous` is the state at the moment of the rejected save. Returns the
		 * latest rows with the user's changed keys reapplied, plus the ids whose
		 * edits had to be dropped because the bot is gone.
		 */
		function rebaseDraft(previous, latestEditor) {
			const bots = botRowsFrom(latestEditor);
			const latestMax = toCount(latestEditor.config?.maxTotalLiveAgents);
			// A shape change (single-bot ↔ multi-bot) invalidates the whole draft.
			if (latestEditor.mode !== previous.mode) return { bots, max: latestMax, dropped: [], modeChanged: true };
			const originals = new Map((previous.originalBots ?? []).map((bot) => [bot.id, bot]));
			const byId = new Map(bots.map((bot) => [bot.id, bot]));
			const dropped = [];
			for (const draft of previous.bots ?? []) {
				const changed = changedBotKeys(originals.get(draft.id), draft);
				if (changed.length === 0) continue;
				const target = byId.get(draft.id);
				if (target === void 0) {
					dropped.push(draft.id);
					continue;
				}
				for (const key of changed) target[key] = draft[key];
			}
			const max = previous.originalMax === previous.maxTotalLiveAgents ? latestMax : previous.maxTotalLiveAgents;
			return { bots, max, dropped, modeChanged: false };
		}

		/** `settings/save-bots` payload — list fields are ARRAYS in bots[]. */
		function buildBotsPayload(rows, max, revision) {
			return {
				revision,
				maxTotalLiveAgents: toCount(max),
				bots: (rows ?? []).map((row) => {
					const bot = {};
					for (const key of BOT_DRAFT_KEYS) {
						bot[key] = LIST_KEYS.includes(key) ? toList(row[key]) : row[key];
					}
					return bot;
				})
			};
		}

		/**
		 * `settings/save-legacy` payload — only the CHANGED root keys, and the root
		 * list fields are comma-separated STRINGS (flat schema), not arrays.
		 * Returns undefined when nothing changed.
		 */
		function buildLegacyPayload(original, draft, revision) {
			const config = {};
			for (const key of LEGACY_DRAFT_KEYS) {
				if (sameValue(original?.[key], draft[key])) continue;
				config[key] = LIST_KEYS.includes(key) ? toList(draft[key]).join(",") : draft[key];
			}
			return Object.keys(config).length === 0 ? void 0 : { revision, config };
		}

		const BOT_ID_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;

		/** Field-level issues, never collapsed into one generic sentence (docs/18 §3.1). */
		function validateBotRows(rows, max, mode) {
			const issues = [];
			if (!Number.isSafeInteger(max) || max < 0) issues.push({ botId: "", field: "maxTotalLiveAgents", message: "invalid.number" });
			const ids = new Set();
			const apps = new Set();
			for (const bot of rows ?? []) {
				const botId = bot.id;
				if (mode !== "legacy" && !BOT_ID_PATTERN.test(botId)) issues.push({ botId, field: "id", message: "invalid.id" });
				if (bot.appId === "") issues.push({ botId, field: "appId", message: "invalid.appId" });
				if (bot.appSecretRef === "") issues.push({ botId, field: "appSecretRef", message: "invalid.appSecretRef" });
				if (bot.workspacePolicy === "locked" && bot.defaultWorkspace.trim() === "") {
					issues.push({ botId, field: "defaultWorkspace", message: "invalid.lockedWorkspace" });
				}
				if (!Number.isSafeInteger(bot.maxLiveAgents) || bot.maxLiveAgents < 0) {
					issues.push({ botId, field: "maxLiveAgents", message: "invalid.number" });
				}
				if (mode !== "legacy") {
					if (ids.has(botId)) issues.push({ botId, field: "id", message: "invalid.duplicateId" });
					if (bot.appId !== "" && apps.has(bot.appId)) issues.push({ botId, field: "appId", message: "invalid.duplicateApp" });
					ids.add(botId);
					apps.add(bot.appId);
				}
			}
			return issues;
		}

		/**
		 * Reason codes the Host reports on `bots/status`. A misconfiguration is a
		 * different conversation from a connection problem: the first is fixed in
		 * this page (or by scanning again), the second by retrying.
		 */
		const REASON_DETAIL_KEYS = {
			credential_missing: "status.reason.credentialMissing",
			duplicate_state_path: "status.reason.duplicateStatePath",
			duplicate_inbound_dir: "status.reason.duplicateInboundDir",
			duplicate_app_id: "status.reason.duplicateAppId",
			duplicate_bot_id: "status.reason.duplicateBotId",
			duplicate_session_namespace: "status.reason.duplicateSession",
			invalid_bot_id: "status.reason.invalidBotId",
			workspace_unavailable: "status.reason.workspaceUnavailable",
			preset_unavailable: "status.reason.presetUnavailable",
			profile_unreadable: "status.reason.profileUnreadable",
			config_invalid: "status.reason.configInvalid"
		};
		const CONFIG_REASON_CODES = Object.keys(REASON_DETAIL_KEYS);

		/**
		 * Status model (docs/18 §2.2). Priority: 已停用 → 配置不完整 → 读取中 →
		 * 配置有问题 → 连接失败 → 限流 → 已连接 → 连接中 → 未连接.
		 * Permission-missing/providerStatus stay inside the scan card (P1).
		 * `label`/`detail` are dictionary keys so every string stays translatable;
		 * `safeDetail` is the Host's already-safe sentence, run through `safeText`
		 * once more so no implementation word or path can reach the screen.
		 * `action` is emitted ONLY where the page actually renders a button.
		 */
		function botStatusModel(bot, status, mode) {
			if (mode !== "legacy" && bot.enabled === false) {
				return { tone: "off", label: "status.disabled", detail: "status.disabledDetail" };
			}
			if (bot.appId === "" || bot.appSecretRef === "") {
				return { tone: "err", label: "status.incomplete", detail: "status.incompleteDetail" };
			}
			if (status === void 0) return { tone: "off", label: "status.loading", detail: "status.loadingDetail" };
			const reason = typeof status.reasonCode === "string" ? status.reasonCode : void 0;
			const safe = safeText(status.detail);
			const extra = safe === void 0 ? {} : { safeDetail: safe };
			if (reason !== void 0 && CONFIG_REASON_CODES.includes(reason)) {
				return {
					tone: "err", label: "status.misconfigured",
					detail: REASON_DETAIL_KEYS[reason], ...extra
				};
			}
			if (reason === "disabled") {
				return { tone: "off", label: "status.disabled", detail: "status.disabledDetail", ...extra };
			}
			if (reason === "rate_limited") {
				return { tone: "warn", label: "status.rateLimited", detail: "status.rateLimitedDetail", ...extra };
			}
			if (reason === "connect_failed" || status.terminalFailure === true || status.status === "degraded") {
				return { tone: "err", label: "status.failed", detail: "status.failedDetail", ...extra, action: "retry" };
			}
			const live = Number.isFinite(status.liveAgents) ? status.liveAgents : 0;
			if (status.connected === true) {
				return { tone: "ok", label: "status.connected", detail: "status.connectedDetail", params: { live } };
			}
			if (status.status === "starting") return { tone: "warn", label: "status.connecting", detail: "status.connectingDetail" };
			return { tone: "err", label: "status.offline", detail: "status.offlineDetail", ...extra };
		}

		/** One-line list summary: 工作区 · 用户/群范围 · 运行中任务. */
		function botRowSummary(bot, status) {
			const segments = [];
			const workspace = bot.defaultWorkspace.trim();
			if (workspace === "") segments.push({ key: "row.workspaceUnset" });
			else segments.push({ key: bot.workspacePolicy === "locked" ? "row.workspaceLocked" : "row.workspace", params: { path: workspace } });
			const chats = toList(bot.allowedChatIds).length;
			segments.push({ key: "row.everyone" });
			if (chats > 0) segments.push({ key: "row.chats", params: { count: chats } });
			const live = Number.isFinite(status?.liveAgents) ? status.liveAgents : 0;
			if (status?.connected === true && live > 0) segments.push({ key: "row.tasks", params: { count: live } });
			return segments;
		}

		/** Display name: the live bot name when known, else an App-suffix fallback. */
		function botIdentity(bot, status) {
			const name = str(status?.botName).trim();
			const suffix = bot.appId === "" ? "" : bot.appId.slice(-6);
			if (name !== "") return { name, suffix };
			if (suffix === "") return { key: "row.newBot", suffix: "" };
			return { key: "row.unnamed", params: { suffix }, suffix };
		}

		function brandKey(brand) {
			return brand === "lark" || brand === "larkoffice" ? "brand.lark" : "brand.feishu";
		}

		/** Visual masking only — the full id stays in the DOM title attribute. */
		function maskId(value) {
			const text = str(value).trim();
			return text.length <= 10 ? text : text.slice(0, 3) + "…" + text.slice(-4);
		}

		function basename(path) {
			const text = str(path).trim();
			if (text === "") return "";
			const parts = text.split(/[\\/]/).filter(Boolean);
			return parts.length === 0 ? text : parts[parts.length - 1];
		}

		function pad2(value) {
			return value < 10 ? "0" + value : String(value);
		}
		/** Clock text for `lastConnectedAt`; `sameDay` lets the caller say 今天. */
		function formatClock(timestamp, now) {
			if (!Number.isFinite(timestamp)) return void 0;
			const at = new Date(timestamp);
			const today = new Date(Number.isFinite(now) ? now : Date.now());
			const clock = pad2(at.getHours()) + ":" + pad2(at.getMinutes());
			const sameDay = at.getFullYear() === today.getFullYear() && at.getMonth() === today.getMonth() && at.getDate() === today.getDate();
			return { sameDay, clock, date: (at.getMonth() + 1) + "-" + pad2(at.getDate()) };
		}

		/**
		 * Structured backend codes → friendly copy. Admin RPC failures use the
		 * `{ok:false, code, message}` envelope; onboarding failures carry their own
		 * `error.code`. Anything unmapped falls back to a generic sentence.
		 */
		const ERROR_CODE_KEYS = {
			// admin / settings RPC
			bad_request: "err.generic",
			conflict: "err.conflict",
			read_only: "err.readOnly",
			legacy_mode: "err.shapeChanged",
			multi_mode: "err.shapeChanged",
			unknown_bot_id: "err.unknownBot",
			last_bot: "err.lastBot",
			validation: "err.validation",
			credential_missing: "err.credential",
			settings_unsafe: "err.settingsUnsafe",
			internal: "err.generic",
			// onboarding
			busy: "err.busy",
			access_denied: "err.accessDenied",
			connection_failed: "err.connectionFailed",
			connection_timeout: "err.connectionTimeout",
			settings_changed: "err.conflict",
			settings_write_failed: "err.settingsUnsafe",
			credential_probe_failed: "err.credentialStore",
			credential_write_failed: "err.credentialStore",
			credential_write_unavailable: "err.credentialStore",
			expired_token: "err.expired",
			duplicate_app: "err.duplicateApp",
			destination_required: "err.generic",
			multi_bot_required: "err.shapeChanged",
			settings_unavailable: "err.settingsUnsafe",
			missing_app: "err.notFound",
			expired: "err.expired",
			cancelled: "err.cancelled",
			abort: "err.cancelled"
		};
		/**
		 * Transport-level fallbacks. These match on the raw text only to CLASSIFY
		 * it — the raw text itself is never rendered (docs/18 §2.4).
		 */
		const ERROR_TEXT_KEYS = [
			["Failed to fetch", "err.offline"],
			["NetworkError", "err.offline"],
			["ERR_CONNECTION", "err.offline"],
			["网络", "err.offline"]
		];

		/**
		 * Map a backend failure to friendly copy. The result carries at most the
		 * Host's own structured, already-safe sentence (`detail`) — never an
		 * Error.message/stack from an unstructured throw (docs/18 §2.4).
		 */
		function friendlyError(error) {
			if (error === void 0 || error === null || error === "") return void 0;
			const structured = typeof error === "object" && error !== null && typeof error.code === "string";
			const code = structured ? error.code : void 0;
			const raw = typeof error === "string" ? error : String(error?.message ?? "");
			const detail = structured ? safeText(error.message) : void 0;
			const supplement = detail === void 0 ? {} : { detail };
			if (code !== void 0 && ERROR_CODE_KEYS[code] !== void 0) return { key: ERROR_CODE_KEYS[code], ...supplement };
			for (const entry of ERROR_TEXT_KEYS) if (raw.includes(entry[0])) return { key: entry[1] };
			return { key: "err.generic", ...supplement };
		}

		function onboardingStatusKey(status) {
			if (status === void 0) return "onboarding.status.loading";
			if (status.connected) return "onboarding.status.connected";
			return "onboarding.status." + status.phase;
		}
		function onboardingActive(status) {
			return ["starting", "qr_ready", "committing", "connecting"].includes(status?.phase);
		}

		// ------------------------------------------------------------- controls
		function toneClass(tone) {
			if (tone === "ok") return cx.dot + " fr_dotOk";
			if (tone === "warn") return cx.dot + " fr_dotWarn";
			if (tone === "err") return cx.dot + " fr_dotErr";
			return cx.dot;
		}
		function toneText(tone) {
			if (tone === "ok") return cx.state + " fr_toneOk";
			if (tone === "warn") return cx.state + " fr_toneWarn";
			if (tone === "err") return cx.state + " fr_toneErr";
			return cx.state;
		}

		function Toggle(props) {
			const className = [cx.toggle, props.on ? cx.toggleOn : "", props.danger ? cx.toggleDanger : ""].filter(Boolean).join(" ");
			return h("button", {
				type: "button", role: "switch", className,
				"aria-checked": props.on === true, "aria-label": props.label,
				disabled: props.disabled === true,
				onClick: () => props.onToggle(!props.on)
			});
		}

		function TextControl(props) {
			return h("input", {
				className: props.small ? cx.input + " " + cx.inputSm : cx.input,
				type: "text", value: props.value, placeholder: props.placeholder,
				disabled: props.disabled === true, "aria-label": props.label,
				onChange: (event) => props.onChange(event.target.value)
			});
		}

		function NumberControl(props) {
			// Digits only: the draft always holds a non-negative integer, so the
			// number never round-trips through NaN while the user is typing.
			return h("input", {
				className: cx.input + " " + cx.inputSm,
				type: "text", inputMode: "numeric", value: String(props.value),
				disabled: props.disabled === true, "aria-label": props.label,
				onChange: (event) => props.onChange(toCount(event.target.value.replace(/[^0-9]/gu, "")))
			});
		}

		function ChipsControl(props) {
			const [text, setText] = react.useState("");
			const commit = () => {
				const added = toList(text);
				setText("");
				if (added.length === 0) return;
				const next = props.values.slice();
				for (const value of added) if (!next.includes(value)) next.push(value);
				props.onChange(next);
			};
			return h("div", { className: cx.chips }, [
				...props.values.map((value, index) => h("span", { className: cx.chip, title: value }, [
					maskId(value),
					h("button", {
						type: "button", className: cx.chipX, disabled: props.disabled === true,
						"aria-label": props.removeLabel, onClick: () => props.onChange(props.values.filter((item) => item !== value))
					}, "×")
				], value + "-" + index)),
				h("input", {
					className: cx.chipInput, value: text, placeholder: props.placeholder,
					disabled: props.disabled === true, "aria-label": props.label,
					onChange: (event) => setText(event.target.value),
					onKeyDown: (event) => {
						if (event.key !== "Enter") return;
						event.preventDefault();
						commit();
					},
					onBlur: commit
				}, void 0, "input")
			]);
		}

		/** 宿主「通用设置」的 setting-row：标题 + 一句说明 + 右侧控件 + 行内错误。 */
		function settingRow(options) {
			return h("div", { className: options.column ? cx.setting + " " + cx.settingCol : cx.setting, ref: options.ref }, [
				h("div", { className: cx.settingText, style: options.column ? { width: "100%" } : void 0 }, [
					h("span", { className: options.danger ? cx.label + " " + cx.labelDanger : cx.label }, options.label),
					options.hint === void 0 ? null : h("p", { className: cx.hint }, options.hint),
					options.error === void 0 ? null : h("p", { className: cx.fieldError, role: "alert" }, options.error)
				], "text"),
				options.control === void 0 ? null : h("div", { className: options.column ? void 0 : cx.ctl }, options.control, "ctl")
			], options.key);
		}

		/**
		 * Friendly line first; the Host's structured, already-safe sentence second.
		 * Nothing else is rendered — no Error.message, no stack, no raw payload.
		 */
		function errorBlock(t, failure, key) {
			if (failure === void 0) return null;
			return h("div", {}, [
				h("p", { className: cx.error, role: "alert" }, t(failure.key), "line"),
				failure.detail === void 0 ? null : h("p", { className: cx.raw }, failure.detail, "detail")
			], key);
		}

		/**
		 * Fail closed: the editor unlocks ONLY on an explicit `guiSafe === true`.
		 * A snapshot that says nothing about it (an older Host, a truncated
		 * response) is treated as unsafe and gets the generic message.
		 */
		function guiBlocked(admin) {
			return admin?.loaded === true
				&& admin.mode !== "unavailable"
				&& admin.mode !== "failed"
				&& admin.guiSafe !== true;
		}
		/** GUI fail-closed banner: one sentence, no editors. */
		function guiBlockedKey(reason) {
			if (reason === "purge_failed") return "gui.blocked.purgeFailed";
			if (reason === "read_only_dirty") return "gui.blocked.readOnlyDirty";
			if (reason === "user_layer_dirty") return "gui.blocked.userLayerDirty";
			return "gui.blocked.generic";
		}

		// ----------------------------------------------------------- onboarding
		function capabilityLabel(t, label, state) {
			return t(label) + "：" + t("onboarding.capability." + (state ?? "unknown"));
		}

		/**
		 * The QR card. Same state machine as before (phases, cancel, retry,
		 * 「在本机打开授权链接」) plus an explicit「刷新二维码」for expired/failed.
		 */
		function OnboardingCard(props) {
			const { t } = props;
			const hook = props.usePersonalAgentOnboarding;
			const snapshot = hook === void 0 ? void 0 : hook((value) => value);
			if (hook === void 0) return null;
			const rawStatus = snapshot?.status;
			const stale = props.baselineRevision !== void 0
				&& (rawStatus?.destination !== props.destination || (rawStatus?.revision ?? -1) <= props.baselineRevision);
			const status = stale ? void 0 : rawStatus;
			const phase = status?.phase ?? "idle";
			const active = onboardingActive(status);
			const acting = snapshot?.acting === true;
			const writable = props.writable !== false;
			const blocked = active || acting || !writable;
			const canCancel = phase === "starting" || phase === "qr_ready";
			const canRefresh = phase === "expired" || phase === "failed";
			const configured = status?.configured === true;
			const capabilityKnown = status?.capabilities !== void 0
				&& (status.capabilities.core !== "unknown" || status.capabilities.enhanced !== "unknown");
			const secondsLeft = status?.expiresAt === void 0 ? void 0 : Math.max(0, Math.ceil((status.expiresAt - Date.now()) / 1000));
			const scanHintKey = status?.mode === "select" ? "onboarding.scanHintSelect"
				: status?.mode === "update" ? "onboarding.scanHintUpdate" : "onboarding.scanHintCreate";
			const statusClass = status?.connected
				? cx.status + " " + cx.statusReady
				: phase === "failed" || phase === "expired"
					? cx.status + " " + cx.statusFailed
					: active ? cx.status + " " + cx.statusBusy : cx.status;
			const start = (mode) => props.onboardingStart(mode, props.destination);
			return h("div", { className: cx.onboarding }, [
				h("div", { className: cx.onboardingHead }, [
					h("div", {}, [
						h("h3", { className: cx.onboardingTitle }, t(props.titleKey), "title"),
						h("p", { className: cx.onboardingDesc }, t(props.descriptionKey), "desc")
					], "text"),
					h("span", { className: statusClass, role: "status" }, t(onboardingStatusKey(status)), "status")
				], "head"),
				status?.qrUrl ? h("div", { className: cx.qrWrap }, [
					status.qrImageDataUrl
						? h("img", { className: cx.qr, src: status.qrImageDataUrl, alt: t("onboarding.qrAlt") }, void 0, "qr")
						: h("div", { className: cx.qr, "aria-label": t("onboarding.qrRendering") }, void 0, "qr"),
					h("div", { className: cx.qrHelp }, [
						h("p", { className: cx.onboardingDesc }, t(scanHintKey), "hint"),
						secondsLeft === void 0 ? null : h("p", { className: cx.onboardingMeta }, t("onboarding.expiresIn") + " " + secondsLeft + "s", "left"),
						h("a", { className: cx.link, href: status.qrUrl, target: "_blank", rel: "noreferrer" }, t("onboarding.openLink"), "link")
					], "help")
				], "qr") : null,
				status?.app ? h("p", { className: cx.onboardingMeta }, [
					status.app.botName, status.app.brand, "App …" + status.app.appIdSuffix
				].filter(Boolean).join(" · "), "app") : null,
				capabilityKnown ? h("div", { className: cx.capabilities }, [
					h("span", { className: cx.capability }, capabilityLabel(t, "onboarding.core", status.capabilities.core), "core"),
					h("span", { className: cx.capability }, capabilityLabel(t, "onboarding.enhanced", status.capabilities.enhanced), "enhanced")
				], "caps") : null,
				status?.capabilities !== void 0 && !capabilityKnown
					? h("p", { className: cx.onboardingMeta }, t("onboarding.capabilityUnavailable"), "capsUnknown") : null,
				status?.providerStatus === "domain_switched"
					? h("p", { className: cx.onboardingMeta }, t("onboarding.domainSwitched"), "domain") : null,
				status?.error ? errorBlock(t, friendlyError(status.error), "statusError") : null,
				snapshot?.transportError ? errorBlock(t, friendlyError(snapshot.transportError), "transportError") : null,
				h("div", { className: cx.actions }, [
					h("button", {
						type: "button", className: cx.primary, disabled: blocked, onClick: () => start("select")
					}, t("onboarding.select"), "select"),
					h("button", {
						type: "button", className: cx.secondary, disabled: blocked, onClick: () => start("create")
					}, t("onboarding.create"), "create"),
					configured || status?.recoverableApp === true ? h("button", {
						type: "button", className: cx.secondary, disabled: blocked,
						onClick: () => {
							const message = tp(t, "onboarding.updateConfirm", { app: status?.app?.appIdSuffix ?? "" });
							if (typeof window !== "undefined" && !window.confirm(message)) return;
							start("update");
						}
					}, t("onboarding.grant"), "grant") : null,
					canRefresh ? h("button", {
						type: "button", className: cx.secondary, disabled: acting || !writable,
						onClick: () => start(status?.mode ?? "select")
					}, t("onboarding.refresh"), "refresh") : null,
					phase === "failed" && configured ? h("button", {
						type: "button", className: cx.secondary, disabled: acting || !writable, onClick: props.onboardingRetry
					}, t("onboarding.retry"), "retry") : null,
					canCancel ? h("button", {
						type: "button", className: cx.secondary, disabled: acting || !writable, onClick: props.onboardingCancel
					}, t("onboarding.cancel"), "cancel") : null,
					props.onClose ? h("button", {
						type: "button", className: cx.secondary, disabled: active || acting, onClick: props.onClose
					}, t(phase === "ready" ? "onboarding.done" : "onboarding.close"), "close") : null
				], "actions"),
				h("p", { className: cx.onboardingMeta }, t("onboarding.footHint"), "foot")
			]);
		}

		// ------------------------------------------------------------- list page
		function BotRow(props) {
			const { t, bot, status, mode } = props;
			const model = botStatusModel(bot, status, mode);
			const identity = botIdentity(bot, status);
			const name = identity.name ?? tp(t, identity.key, identity.params);
			const summary = botRowSummary(bot, status).map((segment) => tp(t, segment.key, segment.params)).join(" · ");
			return h("button", {
				type: "button",
				className: bot.enabled === false && mode !== "legacy" ? cx.row + " " + cx.rowOff : cx.row,
				onClick: props.onOpen
			}, [
				h("span", { className: cx.avatar, "aria-hidden": true }, Array.from(name)[0] ?? "?", "avatar"),
				h("span", { className: cx.rowText }, [
					h("span", { className: cx.rowTitle }, [
						h("span", { className: cx.name }, name, "name"),
						h("span", { className: cx.pill }, t(brandKey(bot.brand)), "brand")
					], "title"),
					h("span", { className: cx.sub }, summary, "sub")
				], "text"),
				h("span", { className: toneText(model.tone) }, [
					h("span", { className: toneClass(model.tone), "aria-hidden": true }, void 0, "dot"),
					h("span", {}, t(model.label), "label")
				], "state"),
				h("span", { className: cx.chev, "aria-hidden": true }, "›", "chev")
			]);
		}

		function BotListPage(props) {
			const { t, admin } = props;
			const disabled = props.busy || !admin.writable;
			const issues = admin.issues ?? [];
			const maxIssue = issues.find((issue) => issue.field === "maxTotalLiveAgents");
			// The draft survives 详情 → 列表 navigation (docs/18 §2.3): the bar keeps
			// reporting every pending change, not only the ones edited on this page.
			const pending = draftChangeCount(admin.originalBots, admin.bots, admin.originalMax, admin.maxTotalLiveAgents);
			return h("div", { className: cx.page }, [
				h("div", { className: cx.head }, [
					h("div", { className: cx.headText }, [
						h("h2", { className: cx.h1 }, t("settings.title"), "title"),
						h("p", { className: cx.intro }, t("page.intro"), "intro")
					], "text")
				], "head"),
				!admin.writable ? h("p", { className: cx.note, role: "status" }, t("settings.readOnly"), "readOnly") : null,
				// Empty state: the QR card IS the page, so it sits at the top.
				// With bots present, it renders BELOW the list instead — right where
				// the 「＋ 添加机器人」 row that opened it lives.
				props.showOnboarding && admin.bots.length === 0
					? h(OnboardingCard, {
						t,
						usePersonalAgentOnboarding: props.usePersonalAgentOnboarding,
						onboardingStart: props.onboardingStart,
						onboardingCancel: props.onboardingCancel,
						onboardingRetry: props.onboardingRetry,
						destination: props.onboardingDestination,
						baselineRevision: props.baselineRevision,
						writable: admin.writable,
						titleKey: "onboarding.firstTitle",
						descriptionKey: "onboarding.firstDescription",
						onClose: props.onCloseOnboarding
					}, void 0, "onboarding")
					: null,
				admin.bots.length === 0 ? null : h("div", { className: cx.card }, [
					...admin.bots.map((bot) => h(BotRow, {
						t, bot, mode: admin.mode, status: props.statuses.get(bot.id),
						onOpen: () => props.onOpen(bot.id)
					}, void 0, bot.id)),
					// The add action lives as the list's last row — the page head keeps
					// only title + intro so nothing crowds the dialog's own
					// 「打开配置文件」/close controls directly above it.
					props.showOnboarding ? null : h("button", {
						type: "button", className: cx.addRow, disabled: disabled || admin.dirty,
						onClick: props.onAdd
					}, [
						h("span", { className: cx.addPlus, "aria-hidden": true }, "＋", "plus"),
						h("span", {}, props.preparing ? t("page.preparing") : t("page.add"), "text")
					], "add")
				], "bots"),
				props.showOnboarding && admin.bots.length > 0
					? h(OnboardingCard, {
						t,
						usePersonalAgentOnboarding: props.usePersonalAgentOnboarding,
						onboardingStart: props.onboardingStart,
						onboardingCancel: props.onboardingCancel,
						onboardingRetry: props.onboardingRetry,
						destination: props.onboardingDestination,
						baselineRevision: props.baselineRevision,
						writable: admin.writable,
						titleKey: "onboarding.addTitle",
						descriptionKey: "onboarding.addDescription",
						onClose: props.onCloseOnboarding
					}, void 0, "onboardingAdd")
					: null,
				admin.mode === "multi" ? h("p", { className: cx.secTitle }, t("page.allBots"), "allTitle") : null,
				admin.mode === "multi" ? h("div", { className: cx.card }, [
					settingRow({
						key: "maxTotal",
						label: t("f.maxTotal"),
						hint: t("f.maxTotalHint"),
						error: maxIssue === void 0 ? void 0 : t(maxIssue.message),
						control: h(NumberControl, {
							value: admin.maxTotalLiveAgents, disabled, label: t("f.maxTotal"),
							onChange: (value) => props.editMax(value)
						})
					})
				], "allCard") : null,
				errorBlock(t, friendlyError(admin.error), "error"),
				admin.conflictNotice === void 0 ? null : h("p", { className: cx.notice, role: "status" }, t(admin.conflictNotice), "conflict"),
				pending === 0 ? null : h("div", { className: cx.saveBar }, [
					h("span", { className: cx.saveCount }, "● " + tp(t, "save.count", { count: pending }), "count"),
					h("div", { className: cx.actions }, [
						h("button", { type: "button", className: cx.secondary, disabled: admin.saving, onClick: props.onDiscard }, t("save.discard"), "discard"),
						h("button", {
							type: "button", className: cx.primary,
							disabled: admin.saving || issues.length > 0 || !admin.writable, onClick: props.onSave
						}, t(admin.saving ? "save.saving" : "save.save"), "save")
					], "buttons")
				], "saveBar")
			]);
		}

		// ----------------------------------------------------------- detail page
		function BotDetailPage(props) {
			const { t, admin, bot } = props;
			const status = props.status;
			const disabled = props.busy || !admin.writable;
			const model = botStatusModel(bot, status, admin.mode);
			const identity = botIdentity(bot, status);
			const name = identity.name ?? tp(t, identity.key, identity.params);
			const clock = formatClock(status?.lastConnectedAt);
			const issues = (admin.issues ?? []).filter((issue) => issue.botId === bot.id);
			const issueFor = (field) => {
				const issue = issues.find((item) => item.field === field);
				return issue === void 0 ? void 0 : t(issue.message);
			};
			const edit = (field, value) => props.editBot(bot.id, field, value);
			const changes = changedBotKeys(props.original, bot).length;
			const isLegacy = admin.mode === "legacy";
			const lastBot = admin.bots.length <= 1;
			const [retryHint, setRetryHint] = react.useState(false);
			react.useEffect(() => { setRetryHint(false); }, [bot.id, model.label]);
			// Retry is a single-bot action only: multi-bot slots reconnect from the
			// saved config, so the page says that instead of inventing an RPC.
			const statusAction = model.action === "retry"
				? h("button", {
					type: "button", className: cx.secondary, disabled,
					onClick: () => { if (isLegacy) props.onboardingRetry(); else setRetryHint(true); }
				}, t("status.actionRetry"), "retry")
				: void 0;
			return h("div", { className: cx.page }, [
				h("div", { className: cx.crumbs }, [
					h("button", { type: "button", className: cx.link, onClick: props.onBack }, t("settings.navLabel"), "back"),
					h("span", { "aria-hidden": true }, "›", "sep"),
					h("span", {}, name, "here")
				], "crumbs"),
				h("div", { className: cx.detailHead }, [
					h("div", { className: cx.identity }, [
						h("span", { className: cx.avatar + " " + cx.avatarLg, "aria-hidden": true }, Array.from(name)[0] ?? "?", "avatar"),
						h("div", { className: cx.rowText }, [
							h("span", { className: cx.rowTitle }, [
								h("span", { className: cx.nameLg }, name, "name"),
								h("span", { className: cx.pill }, t(brandKey(bot.brand)), "brand")
							], "title"),
							h("span", { className: cx.sub }, [
								identity.suffix === "" ? void 0 : tp(t, "detail.app", { suffix: identity.suffix }),
								clock === void 0 ? void 0 : tp(t, clock.sameDay ? "detail.lastConnectedToday" : "detail.lastConnected", { time: clock.sameDay ? clock.clock : clock.date + " " + clock.clock })
							].filter(Boolean).join(" · "), "meta")
						], "text")
					], "identity"),
					isLegacy ? null : h("div", { className: cx.ctl }, [
						h("span", { className: cx.sub }, t("detail.enabled"), "label"),
						h(Toggle, {
							on: bot.enabled !== false, disabled, label: t("detail.enabled"),
							onToggle: (value) => edit("enabled", value)
						}, void 0, "toggle")
					], "enabled")
				], "head"),
				h("div", { className: toneText(model.tone) }, [
					h("span", { className: toneClass(model.tone), "aria-hidden": true }, void 0, "dot"),
					h("span", {}, t(model.label) + " · " + tp(t, model.detail, model.params), "text")
				], "status"),
				model.safeDetail === void 0 ? null : h("p", { className: cx.raw }, model.safeDetail, "statusDetail"),
				statusAction === void 0 ? null : h("div", { className: cx.actions }, [statusAction], "statusAction"),
				retryHint ? h("p", { className: cx.note, role: "status" }, t("status.retryMultiHint"), "retryHint") : null,

				h("p", { className: cx.secTitle }, t("group.workspace"), "gWorkspace"),
				h("div", { className: cx.card }, [
					settingRow({
						key: "defaultWorkspace",
						label: t("f.defaultWorkspace"), hint: t("f.defaultWorkspaceHint"),
						error: issueFor("defaultWorkspace"),
						control: h(TextControl, {
							value: bot.defaultWorkspace, disabled, label: t("f.defaultWorkspace"),
							placeholder: t("p.defaultWorkspace"), onChange: (value) => edit("defaultWorkspace", value)
						})
					}),
					settingRow({
						key: "workspacePolicy",
						label: t("f.workspaceSwitch"), hint: t("f.workspaceSwitchHint"),
						control: h(Toggle, {
							on: bot.workspacePolicy !== "locked", disabled, label: t("f.workspaceSwitch"),
							onToggle: (value) => edit("workspacePolicy", value ? "default" : "locked")
						})
					})
				], "cWorkspace"),

				h("p", { className: cx.secTitle }, t("group.access"), "gAccess"),
				h("div", { className: cx.card }, [
					settingRow({
						key: "userAccess",
						label: t("f.userAccess"), hint: t("f.userAccessHint"),
						control: h("span", { className: cx.sub }, t("row.everyone"))
					}),
					settingRow({
						key: "allowedChatIds", column: true,
						label: t("f.chats"), hint: t("f.chatsHint"),
						control: h(ChipsControl, {
							values: bot.allowedChatIds, disabled, label: t("f.chats"),
							placeholder: t("p.chats"), removeLabel: t("f.chipRemove"),
							onChange: (value) => edit("allowedChatIds", value)
						})
					}),
					settingRow({
						key: "requireMention",
						label: t("f.requireMention"), hint: t("f.requireMentionHint"),
						control: h(Toggle, {
							on: bot.requireMention !== false, disabled, label: t("f.requireMention"),
							onToggle: (value) => edit("requireMention", value)
						})
					})
				], "cAccess"),

				h("p", { className: cx.secTitle }, t("group.agent"), "gAgent"),
				h("div", { className: cx.card }, [
					settingRow({
						key: "profileFile",
						label: t("f.profile"),
						hint: bot.profileFile.trim() === "" ? t("f.profileHint") : basename(bot.profileFile) + " · " + t("f.profileHint"),
						control: h(TextControl, {
							value: bot.profileFile, disabled, label: t("f.profile"),
							placeholder: t("p.profile"), onChange: (value) => edit("profileFile", value)
						})
					}),
					settingRow({
						key: "provider",
						label: t("f.provider"), hint: t("f.providerHint"),
						control: h(TextControl, {
							value: bot.provider, disabled, label: t("f.provider"),
							placeholder: t("p.provider"), onChange: (value) => edit("provider", value)
						})
					}),
					settingRow({
						key: "model",
						label: t("f.model"), hint: t("f.modelHint"),
						control: h(TextControl, {
							value: bot.model, disabled, label: t("f.model"),
							placeholder: t("p.model"), onChange: (value) => edit("model", value)
						})
					}),
					settingRow({
						key: "agentPreset",
						label: t("f.preset"), hint: t("f.presetHint"),
						control: h(TextControl, {
							value: bot.agentPreset, disabled, label: t("f.preset"),
							placeholder: t("p.preset"), onChange: (value) => edit("agentPreset", value)
						})
					}),
					settingRow({
						key: "contextMode",
						label: t("f.context"), hint: t("f.contextHint"),
						control: h(Toggle, {
							on: bot.contextMode !== "off", disabled, label: t("f.context"),
							onToggle: (value) => edit("contextMode", value ? "auto" : "off")
						})
					})
				], "cAgent"),

				h("p", { className: cx.secTitle }, t("group.advanced"), "gAdvanced"),
				h("div", { className: cx.card }, [
					h("details", { className: cx.advanced }, [
						h("summary", { className: cx.advancedSummary }, t("group.advancedOpen"), "summary"),
						settingRow({
							key: "connection",
							label: t("f.connection"),
							hint: [
								t(brandKey(bot.brand)),
								identity.suffix === "" ? void 0 : tp(t, "detail.app", { suffix: identity.suffix }),
								bot.appSecretRef === "" ? void 0 : tp(t, "f.connectionSecret", { ref: bot.appSecretRef })
							].filter(Boolean).join(" · "),
							error: issueFor("appId") ?? issueFor("appSecretRef") ?? issueFor("id"),
							control: isLegacy
								? h("button", {
									type: "button", className: cx.secondary, disabled,
									onClick: () => {
										if (typeof window !== "undefined" && !window.confirm(t("f.rebindConfirm"))) return;
										props.onRebind();
									}
								}, t("f.rebind"))
								: h("span", { className: cx.sub }, t("f.rebindUnavailable"))
						}),
						settingRow({
							key: "maxLiveAgents",
							label: t("f.maxLive"), hint: t("f.maxLiveHint"),
							error: issueFor("maxLiveAgents"),
							control: h(NumberControl, {
								value: bot.maxLiveAgents, disabled, label: t("f.maxLive"),
								onChange: (value) => edit("maxLiveAgents", value)
							})
						}),
						isLegacy ? null : settingRow({
							key: "remove",
							label: t("f.remove"),
							// Removal writes the SAVED list minus this bot, so it must not
							// silently commit the pending draft (review M2).
							hint: lastBot ? t("f.removeLastHint") : admin.dirty ? t("f.removeDirtyHint") : t("f.removeHint"),
							control: h("button", {
								type: "button", className: cx.danger, disabled: disabled || lastBot || admin.dirty === true,
								onClick: () => {
									if (typeof window !== "undefined" && !window.confirm(tp(t, "f.removeConfirm", { name }))) return;
									props.onRemove();
								}
							}, t("f.removeAction"))
						})
					], "details")
				], "cAdvanced"),

				props.manage ? h(OnboardingCard, {
					t,
					usePersonalAgentOnboarding: props.usePersonalAgentOnboarding,
					onboardingStart: props.onboardingStart,
					onboardingCancel: props.onboardingCancel,
					onboardingRetry: props.onboardingRetry,
					destination: "legacy",
					writable: admin.writable,
					titleKey: "onboarding.manageTitle",
					descriptionKey: "onboarding.manageDescription",
					onClose: props.onCloseManage
				}, void 0, "manage") : null,

				errorBlock(t, friendlyError(admin.error), "error"),
				admin.conflictNotice === void 0 ? null : h("p", { className: cx.notice, role: "status" }, t(admin.conflictNotice), "conflict"),

				changes === 0 ? null : h("div", { className: cx.saveBar }, [
					h("span", { className: cx.saveCount }, "● " + tp(t, "save.count", { count: changes }), "count"),
					h("div", { className: cx.actions }, [
						h("button", { type: "button", className: cx.secondary, disabled: admin.saving, onClick: props.onDiscard }, t("save.discard"), "discard"),
						h("button", {
							type: "button", className: cx.primary,
							disabled: admin.saving || (admin.issues ?? []).length > 0 || !admin.writable,
							onClick: props.onSave
						}, t(admin.saving ? "save.saving" : "save.save"), "save")
					], "buttons")
				], "saveBar")
			]);
		}

		// ------------------------------------------------------------ entry page
		/** 设置页顶层分区（左栏「飞书遥控」）：整页的列表 → 详情。 */
		function FeishuRemoteSection(props) {
			const { t } = props;
			const [route, setRoute] = react.useState({ name: "list" });
			const [adding, setAdding] = react.useState(false);
			const [addStarted, setAddStarted] = react.useState(false);
			const [addBaseline, setAddBaseline] = react.useState(-1);
			const [preparing, setPreparing] = react.useState(false);
			const [manage, setManage] = react.useState(false);
			const admin = props.useFeishuBotAdmin?.((value) => value);
			const onboarding = props.usePersonalAgentOnboarding?.((value) => value);
			const onboardingStatus = onboarding?.status;
			const finishedRevision = onboardingStatus?.phase === "ready" ? onboardingStatus.revision ?? -1 : -1;
			react.useEffect(() => {
				if (!adding || !addStarted || finishedRevision <= addBaseline) return;
				void props.refreshBots?.();
				setAdding(false);
				setAddStarted(false);
			}, [adding, addStarted, addBaseline, finishedRevision]);
			if (t === void 0 || admin === void 0) return null;
			if (admin.mode === "unavailable") {
				return h("div", { className: cx.page }, [
					h("h2", { className: cx.h1 }, t("settings.title"), "title"),
					h("p", { className: cx.intro, role: "status" }, t("page.remote"), "remote")
				]);
			}
			if (admin.mode === "failed") {
				return h("div", { className: cx.page }, [
					h("h2", { className: cx.h1 }, t("settings.title"), "title"),
					h("p", { className: cx.intro, role: "status" }, t("page.unavailable"), "unavailable"),
					errorBlock(t, friendlyError(admin.error), "error")
				]);
			}
			if (!admin.loaded) return h("p", { className: cx.intro }, t("page.loading"));
			// Fail closed: the Host says the settings file cannot be edited safely,
			// so the section renders one sentence and NO editor or action at all.
			if (guiBlocked(admin)) {
				return h("div", { className: cx.page }, [
					h("h2", { className: cx.h1 }, t("settings.title"), "title"),
					h("p", { className: cx.blocked, role: "alert" }, t(guiBlockedKey(admin.guiReason)), "blocked")
				]);
			}
			// `writable` comes from the sanitized editor snapshot and NOTHING else:
			// the raw settings descriptor never crosses into the browser (review B1).
			const view = { ...admin, writable: admin.writable === true };
			const busy = admin.saving === true || onboardingActive(onboardingStatus) || onboarding?.acting === true;
			const statuses = new Map((admin.statuses ?? []).map((item) => [item.id, item]));
			const destination = admin.mode === "legacy" ? "legacy" : "new-bot";
			const beginAdd = async () => {
				if (busy || admin.dirty || !view.writable) return;
				setAddBaseline(onboardingStatus?.revision ?? -1);
				setAddStarted(false);
				if (admin.mode === "legacy" && admin.bots.some((bot) => bot.appId !== "")) {
					// 「添加机器人」is the ONLY conversion path (docs/17 §10.3).
					setPreparing(true);
					const converted = await props.convertLegacy();
					setPreparing(false);
					if (!converted) return;
				}
				setRoute({ name: "list" });
				setAdding(true);
			};
			const onboardingStart = (mode, target) => {
				setAddStarted(true);
				props.onboardingStart(mode, target);
			};
			const detailBot = route.name === "detail" ? admin.bots.find((item) => item.id === route.botKey) : void 0;
			if (detailBot !== void 0) {
				const bot = detailBot;
				return h(BotDetailPage, {
					t, admin: view, bot, busy,
					original: (admin.originalBots ?? []).find((item) => item.id === bot.id),
					status: statuses.get(bot.id),
					usePersonalAgentOnboarding: props.usePersonalAgentOnboarding,
					onboardingStart: (mode, target) => props.onboardingStart(mode, target),
					onboardingCancel: props.onboardingCancel,
					onboardingRetry: props.onboardingRetry,
					manage,
					onRebind: () => setManage(true),
					onCloseManage: () => setManage(false),
					editBot: props.editBot,
					onBack: () => { setManage(false); setRoute({ name: "list" }); },
					onSave: () => props.saveBots(),
					onDiscard: () => props.discardBots(),
					onRemove: async () => {
						const removed = await props.removeBot(bot.id);
						if (removed) setRoute({ name: "list" });
					}
				});
			}
			const showOnboarding = adding || admin.bots.length === 0;
			return h(BotListPage, {
				t, admin: view, busy, statuses, preparing,
				showOnboarding,
				onboardingDestination: destination,
				baselineRevision: adding ? addBaseline : void 0,
				usePersonalAgentOnboarding: props.usePersonalAgentOnboarding,
				onboardingStart,
				onboardingCancel: props.onboardingCancel,
				onboardingRetry: props.onboardingRetry,
				onCloseOnboarding: adding ? () => { setAdding(false); setAddStarted(false); } : void 0,
				onAdd: () => { void beginAdd(); },
				onOpen: (botKey) => { setManage(false); setRoute({ name: "detail", botKey }); },
				editMax: props.editMax,
				onSave: () => props.saveBots(),
				onDiscard: () => props.discardBots()
			});
		}

		/** 插件配置里的卡片：纯摘要，不可编辑（docs/18 §3.1）。 */
		function FeishuRemoteSummaryCard(props) {
			const { t } = props;
			const admin = props.useFeishuBotAdmin?.((value) => value);
			if (t === void 0) return null;
			const remote = admin?.mode === "unavailable";
			const failed = admin?.mode === "failed";
			const statuses = new Map((admin?.statuses ?? []).map((item) => [item.id, item]));
			const bots = admin?.bots ?? [];
			if (guiBlocked(admin)) {
				return h("li", { className: cx.summary }, [
					h("span", { className: cx.summaryName }, t("settings.title"), "title"),
					h("span", { className: cx.summaryDesc, role: "alert" }, t(guiBlockedKey(admin.guiReason)), "blocked")
				]);
			}
			return h("li", { className: cx.summary }, [
				h("span", { className: cx.summaryName }, t("settings.title"), "title"),
				h("span", { className: cx.summaryDesc }, t("settings.description"), "desc"),
				remote || failed || bots.length === 0 ? null : h("span", { className: cx.summaryDots }, bots.map((bot) => {
					const status = statuses.get(bot.id);
					const model = botStatusModel(bot, status, admin.mode);
					const identity = botIdentity(bot, status);
					return h("span", { className: cx.summaryDot }, [
						h("span", { className: toneClass(model.tone), "aria-hidden": true }, void 0, "dot"),
						h("span", {}, identity.name ?? tp(t, identity.key, identity.params), "name")
					], void 0, bot.id);
				}), "dots"),
				h("span", { className: cx.summaryDesc, role: failed ? "alert" : void 0 }, t(remote ? "page.remote" : failed ? "page.unavailable" : "card.manageHint"), "hint")
			]);
		}

		/**
		 * Turn an RPC rejection into an Error carrying the structured `code`.
		 * Tolerates both the host envelope (`{ok:false, error:{…}}`) and a flat
		 * `{ok:false, code, message, details}` failure.
		 */
		function rpcFailure(result) {
			const envelope = result?.error ?? {};
			const issues = envelope.details?.issues;
			const issue = Array.isArray(issues) ? issues[0] : void 0;
			// The plugin code travels twice (admin.ts): flat on the result AND inside
			// `error.details.issues[0]`, which is the copy that survives the Host's
			// response parsing. Prefer the issue, then the flat field, then the envelope.
			const failure = typeof issue?.code === "string" ? issue
				: typeof result?.code === "string" ? result
					: envelope;
			return Object.assign(new Error(str(failure.message) || str(envelope.message)), {
				code: failure.code, details: failure.details
			});
		}

		// ------------------------------------------------------------ controllers
		/**
		 * Does an RPC result look like the editor snapshot the Host answers writes
		 * with? Only this sanitized shape is ever adopted (review B1).
		 */
		function isEditorSnapshot(value) {
			return typeof value === "object" && value !== null
				&& (value.mode === "legacy" || value.mode === "multi")
				&& typeof value.config === "object" && value.config !== null;
		}

		/**
		 * How long a forced read may hold the single-flight slot. A Host RPC that
		 * never answers must not freeze regular polling for the rest of the session
		 * (review major-4), so the slot is released once this bound elapses.
		 */
		const FORCED_READ_TIMEOUT_MS = 10000;

		var FeishuBotAdminController = class {
			constructor(connection) {
				this.connection = connection;
				this.snapshot = {
					loaded: false, writable: false, mode: "loading", revision: 0,
					// Unsafe until a snapshot positively reports otherwise (review m2).
					guiSafe: false, guiReason: void 0,
					bots: [], originalBots: [], statuses: [],
					maxTotalLiveAgents: 0, originalMax: 0,
					dirty: false, issues: [], saving: false, error: void 0, conflictNotice: void 0
				};
				this.store = runtime.createSnapshotStore(this.snapshot);
				this.stopped = true;
				this.timer = void 0;
				// One serialized read path (review M3): only the most recently STARTED
				// refresh may publish, and an older snapshot never overwrites a newer one.
				this.requestSequence = 0;
				this.adoptedRevision = -1;
				// The single forced (user-triggered) read in flight, if any. A regular
				// poll never runs alongside one (review major-3), and a second forced
				// read joins this one instead of stacking another RPC (review major-4).
				// The slot is an OWNERSHIP token: `{ generation, timer, bounded }`. Only
				// the read that still owns it may adopt, release it or clear its timer,
				// so a superseded or timed-out read can never touch a later one's slot
				// (review major-1/major-2).
				this.forcedRead = void 0;
				this.forcedGeneration = 0;
			}
			publish(patch) {
				this.snapshot = { ...this.snapshot, ...patch };
				this.store.set(this.snapshot);
			}
			async request(endpoint, payload = {}) {
				const result = await this.connection.rpc.call("/dsh-feishu-remote", endpoint, payload);
				if (result?.ok === false) throw rpcFailure(result);
				return result.value;
			}
			stage(bots, max = this.snapshot.maxTotalLiveAgents) {
				this.publish({
					bots, maxTotalLiveAgents: max,
					dirty: draftChangeCount(this.snapshot.originalBots, bots, this.snapshot.originalMax, max) > 0,
					issues: validateBotRows(bots, max, this.snapshot.mode),
					error: void 0, conflictNotice: void 0
				});
			}
			adopt(editor) {
				const bots = botRowsFrom(editor);
				const max = toCount(editor.config?.maxTotalLiveAgents);
				this.adoptedRevision = toCount(editor.revision);
				this.publish({
					loaded: true, writable: editor.writable === true, mode: editor.mode, revision: editor.revision,
					// Fail closed: a Host that does not report `guiSafe` cannot be taken
					// as safe, and an absent reason renders the generic sentence.
					guiSafe: editor.guiSafe === true,
					guiReason: editor.guiSafe === true ? void 0 : editor.guiReason,
					bots, originalBots: bots.map((bot) => ({ ...bot })),
					maxTotalLiveAgents: max, originalMax: max,
					dirty: false, issues: validateBotRows(bots, max, editor.mode),
					error: void 0, conflictNotice: void 0
				});
			}
			/**
			 * Rebase the pending draft onto a newer snapshot after a CAS conflict
			 * (review B4): the latest content becomes the base, then the user's own
			 * changed keys are replayed on top of it. Edits aimed at a bot that no
			 * longer exists — or at a list whose shape changed — are dropped, and the
			 * page says so instead of silently resending a stale full list.
			 */
			rebase(latest) {
				const previous = {
					mode: this.snapshot.mode,
					originalBots: this.snapshot.originalBots,
					bots: this.snapshot.bots,
					originalMax: this.snapshot.originalMax,
					maxTotalLiveAgents: this.snapshot.maxTotalLiveAgents
				};
				this.adopt(latest);
				const rebased = rebaseDraft(previous, latest);
				this.publish({
					bots: rebased.bots, maxTotalLiveAgents: rebased.max,
					dirty: draftChangeCount(this.snapshot.originalBots, rebased.bots, this.snapshot.originalMax, rebased.max) > 0,
					issues: validateBotRows(rebased.bots, rebased.max, this.snapshot.mode),
					conflictNotice: rebased.modeChanged
						? "conflict.modeChanged"
						: rebased.dropped.length > 0 ? "conflict.dropped" : void 0
				});
			}
			/** Adopt a snapshot a write answered with, unless it is older than the screen. */
			adoptIfNewer(editor) {
				if (!isEditorSnapshot(editor) || toCount(editor.revision) < this.adoptedRevision) return false;
				this.adopt(editor);
				return true;
			}
			/**
			 * `force` marks a read the user's own action triggered (a save, 「刷新」).
			 * Forced reads are authoritative and single-flight: while one is in flight
			 * every regular poll is skipped, so a poll can neither publish an older
			 * snapshot over a just-saved one nor refuse the new one because the draft
			 * still looks dirty (review major-3). No caller ever WAITS on one to finish
			 * a user action, and the slot it holds is time-bounded, so a Host RPC that
			 * hangs can delay a poll but never freeze the page (review major-4).
			 *
			 * Each forced read owns a generation slot with its OWN timer handle. Once
			 * the slot is gone — the bound elapsed, or a newer forced read took over —
			 * the read is DISCARDED: it publishes nothing, releases no slot it no
			 * longer owns and clears no timer that is not its own (review major-1 /
			 * major-2). Joiners get the same BOUNDED promise, never the raw RPC.
			 */
			/**
			 * Is `slot` still the forced read this controller recognizes? Generations
			 * are unique and monotonic, so a read whose generation is no longer the
			 * current one has been superseded or timed out, and owns nothing.
			 */
			ownsForcedRead(slot) {
				return slot !== void 0 && this.forcedRead?.generation === slot.generation;
			}
			async refresh(force = false) {
				if (this.stopped || this.connection.isLoopback === false) return;
				if (!force) {
					// Only ever POSTPONED, never dropped: the mount timer polls again
					// once the forced read settles or hits its bound (review major-4).
					if (this.forcedRead !== void 0) return;
					return this.read(false);
				}
				// Single-flight: a second forced read joins the pending one's bounded
				// promise, so a joiner can never outlive the bound either (review minor).
				if (this.forcedRead !== void 0) return this.forcedRead.bounded;
				const slot = { generation: ++this.forcedGeneration, timer: void 0, bounded: void 0 };
				this.forcedRead = slot;
				// Give up the slot — but only while we still hold it. A late completion
				// must never free a slot, nor cancel a timer, belonging to a later read.
				const release = () => {
					if (!this.ownsForcedRead(slot)) return;
					if (slot.timer !== void 0) { clearTimeout(slot.timer); slot.timer = void 0; }
					this.forcedRead = void 0;
				};
				const pending = this.read(true, slot).then(release, release);
				// A Host that never answers must not freeze the page: past the bound the
				// slot is released and regular polls resume. The still-outstanding RPC is
				// now superseded, so its eventual answer is dropped rather than adopted.
				slot.bounded = Promise.race([pending, new Promise((resolve) => {
					slot.timer = setTimeout(() => { slot.timer = void 0; release(); resolve(); }, FORCED_READ_TIMEOUT_MS);
				})]);
				return slot.bounded;
			}
			/**
			 * Start the post-write top-up read without waiting for it: a write is
			 * complete the moment the Host answered it (review major-4).
			 */
			fireForcedRead() {
				void Promise.resolve(this.refresh(true)).catch(() => void 0);
			}
			/**
			 * One read of the editor snapshot plus the runtime statuses. A forced read
			 * carries the generation `slot` it owns; losing that slot (timed out, or
			 * superseded by a newer forced read) makes the result stale by definition,
			 * and stale results are discarded whole (review major-1).
			 */
			async read(force, slot) {
				const requestId = ++this.requestSequence;
				// A poll that started before a newer read must never undo it. A forced
				// read outranks the sequence — but only while it still owns its slot.
				const superseded = () => force ? !this.ownsForcedRead(slot) : requestId !== this.requestSequence;
				try {
					const [editor, runtimeStatus] = await Promise.all([
						this.request("settings/editor-snapshot"),
						this.request("bots/status")
					]);
					if (this.stopped || superseded()) return;
					// A forced read is authoritative over a dirty draft, but only for
					// content the screen has not already adopted: re-adopting the SAME
					// revision would wipe a draft typed since (review major-1).
					const revision = toCount(editor.revision);
					const adoptable = force
						? revision > this.adoptedRevision || (revision === this.adoptedRevision && !this.snapshot.dirty)
						: revision >= this.adoptedRevision && !this.snapshot.dirty;
					if (adoptable) this.adopt(editor);
					this.publish({ statuses: runtimeStatus.bots ?? [] });
				} catch (error) {
					if (this.stopped || superseded()) return;
					this.publish({
						loaded: true,
						...(this.snapshot.mode === "loading" ? { mode: "failed", writable: false } : {}),
						error: error instanceof Error ? error : new Error(String(error))
					});
				}
			}
			mount() {
				this.stopped = false;
				if (this.connection.isLoopback === false) {
					this.publish({ loaded: true, writable: false, mode: "unavailable" });
					return () => { this.stopped = true; };
				}
				const tick = async () => {
					await this.refresh(false);
					if (!this.stopped) this.timer = setTimeout(tick, 2500);
				};
				void tick();
				return () => {
					this.stopped = true;
					if (this.timer !== void 0) clearTimeout(this.timer);
					if (this.forcedRead?.timer !== void 0) clearTimeout(this.forcedRead.timer);
					// Dropping the slot supersedes whatever forced read still owns it.
					this.forcedRead = void 0;
				};
			}
			async convertLegacy() {
				if (this.snapshot.saving || !this.snapshot.writable) return false;
				this.publish({ saving: true, error: void 0 });
				try {
					this.adoptIfNewer(await this.request("settings/convert-legacy"));
					// The write's own answer is the authoritative state; the follow-up
					// read only tops up runtime statuses, so it is never awaited.
					this.fireForcedRead();
					return true;
				} catch (error) {
					this.publish({ error: error instanceof Error ? error : new Error(String(error)) });
					return false;
				} finally {
					this.publish({ saving: false });
				}
			}
			async commit(bots, max) {
				this.publish({ saving: true, error: void 0 });
				try {
					let saved;
					if (this.snapshot.mode === "legacy") {
						const payload = buildLegacyPayload(this.snapshot.originalBots[0], bots[0], this.snapshot.revision);
						if (payload !== void 0) saved = await this.request("settings/save-legacy", payload);
					} else {
						saved = await this.request("settings/save-bots", buildBotsPayload(bots, max, this.snapshot.revision));
					}
					// The write answers with the post-write snapshot, so the saved state is
					// adopted right here instead of through a follow-up read another poll
					// could supersede (review major-3). The read that follows only tops up
					// the runtime statuses, so the save is DONE without it: awaiting it
					// would leave the page 「保存中」 for as long as the Host stays silent
					// (review major-4).
					this.adoptIfNewer(saved);
					this.fireForcedRead();
					return true;
				} catch (error) {
					const latest = error?.code === "conflict" ? error?.details?.latest : void 0;
					if (latest !== void 0 && latest !== null && typeof latest === "object") this.rebase(latest);
					this.publish({ error: error instanceof Error ? error : new Error(String(error)) });
					return false;
				} finally {
					this.publish({ saving: false });
				}
			}
			async save() {
				if (!this.snapshot.dirty || this.snapshot.issues.length > 0 || this.snapshot.saving || !this.snapshot.writable) return false;
				return this.commit(this.snapshot.bots, this.snapshot.maxTotalLiveAgents);
			}
			/**
			 * Removal is an immediate, confirmed action, so it writes the SAVED list
			 * minus this bot — never the pending draft (review M2). The page keeps the
			 * button disabled while there are unsaved changes; this is the guard.
			 */
			async removeBot(botId) {
				if (this.snapshot.saving || !this.snapshot.writable || this.snapshot.mode !== "multi") return false;
				if (this.snapshot.dirty) return false;
				const originals = (this.snapshot.originalBots ?? []).map((bot) => ({ ...bot }));
				const bots = originals.filter((bot) => bot.id !== botId);
				if (bots.length === 0 || bots.length === originals.length) return false;
				return this.commit(bots, this.snapshot.originalMax);
			}
			discard() {
				const bots = (this.snapshot.originalBots ?? []).map((bot) => ({ ...bot }));
				this.publish({
					bots, maxTotalLiveAgents: this.snapshot.originalMax, dirty: false,
					issues: validateBotRows(bots, this.snapshot.originalMax, this.snapshot.mode),
					error: void 0, conflictNotice: void 0
				});
			}
			inject() {
				return {
					hooks: { feishuBotAdmin: this.store },
					convertLegacy: () => this.convertLegacy(),
					refreshBots: () => this.refresh(true),
					editBot: (botId, field, value) => this.stage(this.snapshot.bots.map(
						(bot) => bot.id === botId ? { ...bot, [field]: value } : bot
					)),
					editMax: (value) => this.stage(this.snapshot.bots, toCount(value)),
					removeBot: (botId) => this.removeBot(botId),
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
				if (result?.ok === false) throw rpcFailure(result);
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
					if (requestId === this.requestSequence) this.publish({ transportError: error instanceof Error ? error : new Error(String(error)) });
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
					if (requestId === this.requestSequence) this.publish({ transportError: error instanceof Error ? error : new Error(String(error)) });
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
					this.timer = setTimeout(tick, onboardingActive(this.snapshot.status) ? 750 : 2500);
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
		// `settingsScope` is deliberately absent: the raw settings descriptor (app
		// secret, host-only paths, …) must never reach the browser, so the GUI reads
		// only the sanitized `settings/editor-snapshot` over the loopback RPC.
		const inject = ["slots", "locale", "connection", "remote"];

		const en = {
			"settings.title": "Feishu Remote",
			"settings.navLabel": "Feishu Remote",
			"settings.description": "Run tasks on this Mac from Feishu — one bot per Feishu app.",
			"settings.readOnly": "This deployment is read-only: bots cannot be changed from here.",
			"page.intro": "Send tasks to the DSH on this Mac from Feishu on your phone. Each bot maps to one Feishu app and is configured on its own.",
			"page.add": "Add a bot",
			"page.preparing": "Preparing…",
			"page.loading": "Loading bots…",
			"page.remote": "This page is not open on the Host machine, so bots cannot be managed here.",
			"page.unavailable": "Feishu Remote is unavailable. Restart DSH; if it still does not recover, check that the plugin version matches DSH.",
			"page.allBots": "All bots",
			"card.manageHint": "Manage it under “Feishu Remote” in the left sidebar.",
			"brand.feishu": "Feishu", "brand.lark": "Lark",
			"row.newBot": "New bot", "row.unnamed": "Bot …{suffix}",
			"row.workspace": "{path}", "row.workspaceLocked": "{path} (fixed)", "row.workspaceUnset": "No default workspace",
			"row.everyone": "Open to everyone", "row.chats": "{count} group(s)", "row.tasks": "{count} task(s) running",
			"status.disabled": "Disabled", "status.disabledDetail": "This bot is turned off and ignores messages.",
			"status.incomplete": "Incomplete", "status.incompleteDetail": "Connection details are missing — scan again to bind it.",
			"status.loading": "Loading", "status.loadingDetail": "Reading the connection state…",
			"status.failed": "Connection failed", "status.failedDetail": "The bot could not stay connected to Feishu.",
			"status.misconfigured": "Configuration problem",
			"status.reason.credentialMissing": "The stored secret for this bot is missing — scan again to bind it.",
			"status.reason.duplicateStatePath": "Two bots are set to share one data folder; give this one its own folder in cordis.patch.yml on this machine.",
			"status.reason.duplicateInboundDir": "Two bots are set to share one incoming-message folder; give this one its own folder in cordis.patch.yml on this machine.",
			"status.reason.duplicateAppId": "Another bot already uses this Feishu app.",
			"status.reason.profileUnreadable": "The role description file could not be read — check the path below.",
			"status.reason.duplicateBotId": "This bot is a duplicate of another one; remove one of them.",
			"status.reason.duplicateSession": "Only one bot can keep the original chat identity.",
			"status.reason.invalidBotId": "This bot could not be identified; scan again to bind it.",
			"status.reason.workspaceUnavailable": "The default workspace is unavailable — check the directory below.",
			"status.reason.presetUnavailable": "The agent preset is unavailable — pick another one or leave it empty.",
			"status.reason.configInvalid": "Some settings are incomplete or not allowed — check the rows below.",
			"status.rateLimited": "Slowed down by Feishu", "status.rateLimitedDetail": "Feishu is limiting requests; the bot keeps retrying on its own.",
			"status.actionRetry": "Retry",
			"status.retryMultiHint": "Check the settings below and save — the bot reconnects on its own.",
			"status.connected": "Connected", "status.connectedDetail": "{live} task(s) running",
			"status.connecting": "Connecting", "status.connectingDetail": "Establishing the connection…",
			"status.offline": "Not connected", "status.offlineDetail": "The bot is currently not connected.",
			"detail.enabled": "Enabled",
			"detail.app": "App …{suffix}",
			"detail.lastConnectedToday": "last connected {time} (this run)",
			"detail.lastConnected": "last connected {time} (this run)",
			"group.workspace": "Workspace", "group.access": "Chat access",
			"group.agent": "Role and model", "group.advanced": "Advanced", "group.advancedOpen": "Connection, limits and removal",
			"f.defaultWorkspace": "Default workspace",
			"f.defaultWorkspaceHint": "Directory a new chat binds to. Leave empty to let people pick it in Feishu.",
			"f.workspaceSwitch": "Allow switching workspace in chat",
			"f.workspaceSwitchHint": "Off: every chat is fixed to the default workspace and /workspace is rejected.",
			"f.userAccess": "User access",
			"f.userAccessHint": "There is no per-user allowlist. Anyone who can reach the bot can send it tasks.",
			"f.chats": "Restrict to groups",
			"f.chatsHint": "Empty accepts messages from any group the bot has joined. Add group IDs only when this bot should be limited to specific groups.",
			"f.chipRemove": "Remove",
			"f.requireMention": "First use in a topic needs an @mention",
			"f.requireMentionHint": "Topic chats go @-free after the first mention. Ordinary groups ALWAYS need an @ for every task.",
			"f.profile": "Role description (Profile)",
			"f.profileHint": "A local Markdown file sent as the system prompt. Never put secrets in it.",
			"f.provider": "Model provider", "f.providerHint": "Empty follows the DSH default.",
			"f.model": "Model", "f.modelHint": "Empty follows the DSH default.",
			"f.preset": "Agent preset", "f.presetHint": "Empty follows the DSH default.",
			"f.context": "Use Feishu chat history as context",
			"f.contextHint": "Recent group/topic/private history is sent to the model provider with each request. Off reads nothing.",
			"f.connection": "Connection", "f.connectionSecret": "secret {ref} (stored on this machine)",
			"f.rebind": "Scan again to rebind…",
			"f.rebindConfirm": "Scanning again replaces the app this bot uses. Continue?",
			"f.rebindUnavailable": "To change the app, add a new bot and remove this one.",
			"f.maxLive": "Task limit for this bot", "f.maxLiveHint": "0 means unlimited.",
			"f.maxTotal": "Task limit across all bots", "f.maxTotalHint": "Total for every bot. 0 means unlimited.",
			"f.remove": "Remove bot", "f.removeAction": "Remove…",
			"f.removeHint": "Removes the DSH configuration only; the Feishu app and its secret stay.",
			"f.removeDirtyHint": "Save or discard your current changes first.",
			"f.removeLastHint": "Keep at least one bot — turn it off instead if you do not need it.",
			"f.removeConfirm": "Remove “{name}” from DSH? The Feishu app itself is not deleted.",
			"p.defaultWorkspace": "e.g. /Users/you/Projects/curio",
			"p.chats": "Paste oc_… and press Enter",
			"p.profile": "e.g. /Users/you/.dsh/bot-profiles/curio.md",
			"p.provider": "e.g. deepseek", "p.model": "e.g. deepseek-v4-flash", "p.preset": "e.g. standard",
			"save.count": "{count} unsaved change(s)", "save.discard": "Discard", "save.save": "Save", "save.saving": "Saving…",
			"invalid.appId": "Missing App ID — scan again to bind this bot.",
			"invalid.appSecretRef": "Missing the stored secret name — scan again to bind this bot.",
			"invalid.id": "This bot could not be identified; scan again to bind it.",
			"invalid.duplicateId": "The same bot appears twice; remove one of them before saving.",
			"invalid.duplicateApp": "This Feishu app is already used by another bot.",
			"invalid.lockedWorkspace": "Set a default workspace before turning off in-chat switching.",
			"invalid.number": "Enter 0 or a larger whole number.",
			"err.generic": "That did not go through. Please try again.",
			"err.conflict": "The settings changed elsewhere just now; the latest version was loaded with your edits kept — check and save again.",
			"err.lastBot": "Keep at least one bot — turn it off instead of removing it.",
			"err.credential": "This bot's secret is not stored on this machine yet; scan again to bind it.",
			"err.readOnly": "This deployment does not allow changing settings from this page.",
			"err.busy": "Another operation is running. Try again in a moment.",
			"err.duplicateApp": "That Feishu app has already been added.",
			"err.cancelled": "The operation was cancelled.",
			"err.expired": "The QR code expired. Refresh it and scan again.",
			"err.accessDenied": "The authorization was declined in Feishu. Scan again to approve it.",
			"err.connectionFailed": "The bot could not connect to Feishu.",
			"err.connectionTimeout": "Connecting to Feishu timed out. Check the network and try again.",
			"err.credentialStore": "The secret could not be stored safely on this machine. Check that DSH can write its credential store, then scan again.",
			"err.notFound": "That item no longer exists; reopen this page.",
			"err.unknownBot": "That bot no longer exists on this machine; reopen this page.",
			"err.validation": "Some fields were not accepted. Check the marked rows and try again.",
			"err.settingsUnsafe": "The settings cannot be changed safely right now. Check the DSH settings file on this machine, then reopen this page.",
			"err.shapeChanged": "The bot list changed elsewhere; reopen this page and try again.",
			"err.offline": "Cannot reach the local DSH service. Check that it is still running.",
			"conflict.dropped": "Bots were added or removed elsewhere just now, so your edits to a bot that no longer exists were dropped. Check the list and save again.",
			"conflict.modeChanged": "The bot list was restructured elsewhere just now, so your unsaved changes were dropped. Check the list and save again.",
			"gui.blocked.purgeFailed": "Old bot settings are still left in the settings file, so this page cannot edit them safely. Check the DSH settings file on this machine, then reopen this page.",
			"gui.blocked.readOnlyDirty": "These settings come from a file this machine may not rewrite, and it still holds unsaved changes, so this page cannot edit them safely.",
			"gui.blocked.userLayerDirty": "The settings file was changed outside this page. Editing is paused here so those changes are not overwritten.",
			"gui.blocked.generic": "These settings cannot be edited safely from this page right now. Check the DSH settings file on this machine, then reopen this page.",
			"onboarding.firstTitle": "Scan with Feishu to connect your first bot",
			"onboarding.firstDescription": "Pick a bot you already own, or create a new one. Its secret is stored on this machine and anyone who can reach the bot can use it.",
			"onboarding.addTitle": "Add a bot",
			"onboarding.addDescription": "Scan to pick an existing bot or create a new one. App ID, secret storage and the connection are configured automatically; user access is open.",
			"onboarding.manageTitle": "Rebind this bot",
			"onboarding.manageDescription": "Scanning here replaces the app this bot uses; it does not add another bot.",
			"onboarding.select": "Use an existing bot", "onboarding.create": "Create a new bot",
			"onboarding.grant": "Grant missing permissions", "onboarding.refresh": "Refresh QR code",
			"onboarding.retry": "Retry connection", "onboarding.cancel": "Cancel",
			"onboarding.done": "Done", "onboarding.close": "Close",
			"onboarding.qrAlt": "Feishu authorization QR code", "onboarding.qrRendering": "Rendering QR code",
			"onboarding.scanHintCreate": "Scan with Feishu/Lark, review the permissions, then confirm creating a new bot.",
			"onboarding.scanHintSelect": "Scan with Feishu/Lark, choose a bot you already own, review the permissions, then confirm.",
			"onboarding.scanHintUpdate": "Scan with Feishu/Lark, review the permission changes for this bot, then confirm.",
			"onboarding.expiresIn": "Expires in", "onboarding.openLink": "Open the authorization link on this device",
			"onboarding.footHint": "Using Lark (international)? It is detected automatically after the scan. Scanning only works on the Host machine (localhost).",
			"onboarding.updateConfirm": "Re-authorize App …{app} with the messaging, event, card, history and reaction permissions? Feishu shows the final diff before applying it.",
			"onboarding.capabilityUnavailable": "This tenant did not expose a complete permission list; connection health is used as the readiness check.",
			"onboarding.domainSwitched": "Switched to the Lark (international) domain and continued.",
			"onboarding.core": "Core remote", "onboarding.enhanced": "Enhanced experience",
			"onboarding.capability.ok": "granted", "onboarding.capability.missing": "partially missing", "onboarding.capability.unknown": "awaiting verification",
			"onboarding.status.loading": "Loading", "onboarding.status.idle": "Not set up", "onboarding.status.starting": "Generating QR code",
			"onboarding.status.qr_ready": "Waiting for scan", "onboarding.status.committing": "Saving securely", "onboarding.status.connecting": "Connecting",
			"onboarding.status.ready": "Ready", "onboarding.status.connected": "Connected", "onboarding.status.failed": "Needs attention",
			"onboarding.status.cancelled": "Cancelled", "onboarding.status.expired": "QR expired"
		};

		const zh = {
			"settings.title": "飞书遥控",
			"settings.navLabel": "飞书遥控",
			"settings.description": "用手机飞书给这台电脑上的 DSH 发任务，一个机器人对应一个飞书应用。",
			"settings.readOnly": "当前部署为只读：这里无法修改机器人。",
			"page.intro": "在手机飞书里给这台电脑上的 DSH 发任务。每个机器人对应一个飞书应用，各自独立配置。",
			"page.add": "添加机器人",
			"page.preparing": "正在准备…",
			"page.loading": "正在读取机器人…",
			"page.remote": "此页面不是在 Host 本机打开，无法管理机器人",
			"page.unavailable": "飞书遥控服务暂时不可用。请重启 DSH；如果仍未恢复，请检查插件版本是否与 DSH 一致。",
			"page.allBots": "全部机器人",
			"card.manageHint": "请在左栏「飞书遥控」中管理",
			"brand.feishu": "飞书", "brand.lark": "Lark",
			"row.newBot": "新机器人", "row.unnamed": "机器人 …{suffix}",
			"row.workspace": "{path}", "row.workspaceLocked": "{path}（已锁定）", "row.workspaceUnset": "未设置默认工作区",
			"row.everyone": "所有人可用", "row.chats": "限定 {count} 个群聊", "row.tasks": "正在运行 {count} 个任务",
			"status.disabled": "已停用", "status.disabledDetail": "这个机器人已停用，不会接收消息。",
			"status.incomplete": "待完成", "status.incompleteDetail": "还缺少连接信息，请重新扫码绑定。",
			"status.loading": "读取中", "status.loadingDetail": "正在读取连接状态…",
			"status.failed": "连接失败", "status.failedDetail": "机器人没能保持与飞书的连接。",
			"status.misconfigured": "配置有问题",
			"status.reason.credentialMissing": "这个机器人的 Secret 没有保存在本机，请重新扫码绑定。",
			"status.reason.duplicateStatePath": "有两个机器人用了同一个数据目录，请在本机的 cordis.patch.yml 里给这一个改成单独的目录。",
			"status.reason.duplicateInboundDir": "有两个机器人用了同一个收信目录，请在本机的 cordis.patch.yml 里给这一个改成单独的目录。",
			"status.reason.duplicateAppId": "这个飞书应用已经被另一个机器人使用了。",
			"status.reason.profileUnreadable": "角色说明文件读不到，请检查下面填写的路径。",
			"status.reason.duplicateBotId": "这个机器人和另一个重复了，请移除其中一个。",
			"status.reason.duplicateSession": "只能有一个机器人继续使用原来的会话身份。",
			"status.reason.invalidBotId": "无法识别这个机器人，请重新扫码绑定。",
			"status.reason.workspaceUnavailable": "默认工作区不可用，请检查下面填写的目录。",
			"status.reason.presetUnavailable": "Agent 预设不可用，请换一个或留空。",
			"status.reason.configInvalid": "有设置不完整或不被允许，请检查下面的项目。",
			"status.rateLimited": "已被飞书限流", "status.rateLimitedDetail": "飞书正在限制请求频率，机器人会自动重试。",
			"status.actionRetry": "重试",
			"status.retryMultiHint": "请检查配置后保存，机器人会自动重连",
			"status.connected": "已连接", "status.connectedDetail": "正在运行 {live} 个任务",
			"status.connecting": "连接中", "status.connectingDetail": "正在建立连接…",
			"status.offline": "未连接", "status.offlineDetail": "机器人当前未连接。",
			"detail.enabled": "启用",
			"detail.app": "App …{suffix}",
			"detail.lastConnectedToday": "本次运行最近连接 今天 {time}",
			"detail.lastConnected": "本次运行最近连接 {time}",
			"group.workspace": "工作区", "group.access": "使用范围",
			"group.agent": "角色与模型", "group.advanced": "高级", "group.advancedOpen": "连接信息、任务上限与移除",
			"f.defaultWorkspace": "默认工作区",
			"f.defaultWorkspaceHint": "新会话首次绑定的目录。留空时由使用者在飞书里选择。",
			"f.workspaceSwitch": "允许在聊天里切换工作区",
			"f.workspaceSwitchHint": "关闭后所有聊天固定使用默认工作区，/workspace 命令会被拒绝。",
			"f.userAccess": "操作者",
			"f.userAccessHint": "不设个人白名单，任何能联系到机器人的人都可以给它发任务。",
			"f.chats": "限定群聊",
			"f.chatsHint": "留空时接受机器人已加入的任意群；只有需要限定到特定群时才填写群 ID。",
			"f.chipRemove": "移除",
			"f.requireMention": "话题首次使用需要 @机器人",
			"f.requireMentionHint": "话题群首次 @ 之后该话题免 @。普通群每一轮任务始终需要 @，不受此开关影响。",
			"f.profile": "角色说明（Profile）",
			"f.profileHint": "本机 Markdown 文件，作为 system prompt 发给模型。不要放密钥。",
			"f.provider": "模型提供方", "f.providerHint": "留空跟随 DSH 当前默认。",
			"f.model": "模型", "f.modelHint": "留空跟随 DSH 当前默认。",
			"f.preset": "Agent 预设", "f.presetHint": "留空跟随 DSH 当前默认。",
			"f.context": "把飞书聊天记录作为上下文",
			"f.contextHint": "最近的群聊/话题/私聊历史会随请求发给模型提供商。关闭后完全不读取。",
			"f.connection": "连接信息", "f.connectionSecret": "Secret {ref}（已保存在本机）",
			"f.rebind": "重新扫码绑定…",
			"f.rebindConfirm": "重新扫码会把这个机器人换成你扫码选择的应用，确定继续吗？",
			"f.rebindUnavailable": "要更换应用，请先添加新机器人再移除这一个。",
			"f.maxLive": "这个机器人同时运行的任务上限", "f.maxLiveHint": "0 表示不限制。",
			"f.maxTotal": "同时运行的任务上限", "f.maxTotalHint": "所有机器人合计。0 表示不限制。",
			"f.remove": "移除机器人", "f.removeAction": "移除…",
			"f.removeHint": "只从 DSH 移除配置，不会删除飞书里的应用和已保存的 Secret。",
			"f.removeDirtyHint": "请先保存或放弃当前修改",
			"f.removeLastHint": "至少要保留一个机器人；暂时不用可以先停用它。",
			"f.removeConfirm": "从 DSH 移除「{name}」？飞书里的应用本身不会被删除。",
			"p.defaultWorkspace": "例如：/Users/you/Projects/curio",
			"p.chats": "粘贴 oc_… 后回车添加",
			"p.profile": "例如：/Users/you/.dsh/bot-profiles/curio.md",
			"p.provider": "例如：deepseek", "p.model": "例如：deepseek-v4-flash", "p.preset": "例如：standard",
			"save.count": "{count} 处修改未保存", "save.discard": "放弃", "save.save": "保存", "save.saving": "保存中…",
			"invalid.appId": "缺少 App ID，请重新扫码绑定这个机器人。",
			"invalid.appSecretRef": "缺少已保存的 Secret 名称，请重新扫码绑定这个机器人。",
			"invalid.id": "无法识别这个机器人，请重新扫码绑定。",
			"invalid.duplicateId": "同一个机器人出现了两次，请先移除其中一个再保存。",
			"invalid.duplicateApp": "这个飞书应用已经被另一个机器人使用了。",
			"invalid.lockedWorkspace": "关闭「允许在聊天里切换工作区」时，必须填写默认工作区。",
			"invalid.number": "请填写 0 或更大的整数。",
			"err.generic": "这次操作没有完成，请重试。",
			"err.conflict": "设置刚刚在别处被改动，已读取最新内容并保留你的修改，请确认后重新保存。",
			"err.lastBot": "至少要保留一个机器人；暂时不用请把它停用。",
			"err.credential": "这个机器人的 Secret 还没保存在本机，请重新扫码绑定。",
			"err.readOnly": "当前部署不允许在这个页面里修改设置。",
			"err.busy": "另一个操作正在进行，请稍后再试。",
			"err.duplicateApp": "这个飞书应用已经添加过了。",
			"err.cancelled": "操作已取消。",
			"err.expired": "二维码已过期，请刷新后重新扫码。",
			"err.accessDenied": "飞书里拒绝了这次授权，请重新扫码并同意。",
			"err.connectionFailed": "机器人没能连上飞书。",
			"err.connectionTimeout": "连接飞书超时，请检查网络后重试。",
			"err.credentialStore": "无法在本机安全保存 Secret。请确认 DSH 可以写入它的凭据存储后重新扫码。",
			"err.notFound": "对应的内容已不存在，请重新打开页面。",
			"err.unknownBot": "这个机器人在本机已经不存在了，请重新打开页面。",
			"err.validation": "有内容没有通过检查，请修改标出的项目后重试。",
			"err.settingsUnsafe": "现在无法安全地修改设置。请在这台电脑上检查 DSH 设置文件后重新打开本页。",
			"err.shapeChanged": "机器人列表在别处发生了变化，请重新打开页面再试。",
			"err.offline": "连不上本机的 DSH 服务，请确认它仍在运行。",
			"conflict.dropped": "刚才别处新增或移除了机器人，你对已不存在的机器人所做的修改已被丢弃，请检查后重新保存。",
			"conflict.modeChanged": "机器人列表刚才在别处发生了结构变化，未保存的修改已被丢弃，请检查后重新保存。",
			"gui.blocked.purgeFailed": "设置文件里还残留着上一次没有清理干净的机器人配置，界面暂时无法安全编辑。请在这台电脑上检查 DSH 设置文件后重新打开本页。",
			"gui.blocked.readOnlyDirty": "当前设置来自一个本机不能改写的文件，并且还有未保存的改动，界面暂时无法安全编辑。",
			"gui.blocked.userLayerDirty": "设置文件在本页之外被改动过，为避免覆盖这些改动，界面暂时停止编辑。",
			"gui.blocked.generic": "当前设置无法在界面里安全编辑。请在这台电脑上检查 DSH 设置文件后重新打开本页。",
			"onboarding.firstTitle": "用手机飞书扫码，连接第一个机器人",
			"onboarding.firstDescription": "扫码后选择一个你已有的机器人，或创建一个新的。Secret 会保存在本机，任何能联系到机器人的人都可以使用它。",
			"onboarding.addTitle": "添加机器人",
			"onboarding.addDescription": "扫码选择已有机器人，或创建一个新的。App ID、Secret 存储和长连接会自动配置，操作者默认对所有人开放。",
			"onboarding.manageTitle": "重新扫码绑定",
			"onboarding.manageDescription": "在这里扫码会替换这个机器人使用的应用，不会新增机器人。",
			"onboarding.select": "选择已有机器人", "onboarding.create": "创建新机器人",
			"onboarding.grant": "补开缺失权限", "onboarding.refresh": "刷新二维码",
			"onboarding.retry": "重试连接", "onboarding.cancel": "取消",
			"onboarding.done": "完成", "onboarding.close": "关闭",
			"onboarding.qrAlt": "飞书授权二维码", "onboarding.qrRendering": "正在生成二维码",
			"onboarding.scanHintCreate": "请用手机飞书/Lark 扫码，核对权限清单后确认创建新机器人。",
			"onboarding.scanHintSelect": "请用手机飞书/Lark 扫码，选择你已经创建的机器人，核对权限后确认绑定。",
			"onboarding.scanHintUpdate": "请用手机飞书/Lark 扫码，核对这个机器人的权限变更后确认。",
			"onboarding.expiresIn": "剩余", "onboarding.openLink": "在本机打开授权链接",
			"onboarding.footHint": "用 Lark（海外版）？扫码后会自动识别。扫码只能在 Host 本机（localhost）打开的页面里进行。",
			"onboarding.updateConfirm": "确认给 App …{app} 补开本插件申请的消息、事件、卡片、历史与 reaction 权限吗？飞书会在应用前再次展示最终权限差异。",
			"onboarding.capabilityUnavailable": "当前租户未返回完整权限清单；页面以机器人的连接健康状态作为最终就绪依据。",
			"onboarding.domainSwitched": "已切换到 Lark（海外版）域名并继续。",
			"onboarding.core": "核心遥控", "onboarding.enhanced": "增强体验",
			"onboarding.capability.ok": "已授权", "onboarding.capability.missing": "部分缺失", "onboarding.capability.unknown": "待验证",
			"onboarding.status.loading": "正在读取", "onboarding.status.idle": "尚未开通", "onboarding.status.starting": "正在生成二维码",
			"onboarding.status.qr_ready": "等待扫码", "onboarding.status.committing": "正在安全保存", "onboarding.status.connecting": "正在连接",
			"onboarding.status.ready": "已就绪", "onboarding.status.connected": "已连接", "onboarding.status.failed": "需要处理",
			"onboarding.status.cancelled": "已取消", "onboarding.status.expired": "二维码已过期"
		};

		// ------------------------------------------------ legacy transcript display
		const FEISHU_CONTEXT_TYPES = new Set(["feishu-context", "feishu-runtime-context"]);

		/**
		 * Return the user-visible suffix after one or more leading Feishu context
		 * objects. This is deliberately a structural JSON scan rather than a regex:
		 * quoted braces and escaped quotes inside chat history must not end the
		 * frame early.
		 */
		function splitLegacyFeishuMessageText(text) {
			if (typeof text !== "string") return void 0;
			let offset = 0;
			let removed = false;
			for (;;) {
				if (text[offset] !== "{") break;
				let depth = 0;
				let inString = false;
				let escaped = false;
				let end = -1;
				for (let index = offset; index < text.length; index += 1) {
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
						if (depth === 0) { end = index + 1; break; }
					}
				}
				if (end < 0) return void 0;
				try {
					const frame = JSON.parse(text.slice(offset, end));
					if (frame === null || typeof frame !== "object" || !FEISHU_CONTEXT_TYPES.has(frame.type)) break;
				} catch {
					return void 0;
				}
				removed = true;
				offset = end;
			}
			const visible = text.slice(offset);
			return removed && visible !== "" ? visible : void 0;
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
			// 本模块的任何注册失败只影响自己的设置入口（不显示 + 控制台报错），
			// 绝不拖垮宿主界面。keyed-slot 契约已在 dsh 0.1.5-rc.1 复核。
			try {
				ctx.effect(() => ctx.locale.register(NS, { en, zh }), "dsh-feishu-remote: dictionaries");
				const onboardingController = new PersonalAgentOnboardingController(ctx.connection);
				const botAdminController = new FeishuBotAdminController(ctx.connection);
				ctx.effect(() => onboardingController.mount(), "dsh-feishu-remote: PersonalAgent onboarding polling");
				ctx.effect(() => botAdminController.mount(), "dsh-feishu-remote: multi-bot admin polling");
				const injection = () => {
					const onboarding = onboardingController.inject();
					const bots = botAdminController.inject();
					return {
						...onboarding,
						...bots,
						hooks: { ...onboarding.hooks, ...bots.hooks }
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
					}, FeishuRemoteSummaryCard));
				} catch (error) {
					console.error("[dsh-feishu-remote] slot \"settings.plugin.item\" 注册失败（摘要卡不显示，不影响设置页分区与宿主界面）：", error);
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
					console.error("[dsh-feishu-remote] slot \"settings.section\" 注册失败（左栏分区不显示，不影响摘要卡与宿主界面）：", error);
				}
			} catch (error) {
				console.error("[dsh-feishu-remote] 设置入口注册失败（界面不显示，宿主界面不受影响）：", error);
			}
		}
		exports.apply = apply;
		exports.inject = inject;
		exports.BotDetailPage = BotDetailPage;
		exports.FeishuBotAdminController = FeishuBotAdminController;
		exports.FeishuRemoteSection = FeishuRemoteSection;
		exports.FeishuRemoteSummaryCard = FeishuRemoteSummaryCard;
		exports.botIdentity = botIdentity;
		exports.botRowsFrom = botRowsFrom;
		exports.botRowSummary = botRowSummary;
		exports.botStatusModel = botStatusModel;
		exports.buildBotsPayload = buildBotsPayload;
		exports.buildLegacyPayload = buildLegacyPayload;
		exports.changedBotKeys = changedBotKeys;
		exports.draftChangeCount = draftChangeCount;
		exports.formatClock = formatClock;
		exports.guiBlocked = guiBlocked;
		exports.guiBlockedKey = guiBlockedKey;
		exports.friendlyError = friendlyError;
		exports.maskId = maskId;
		exports.normalizeBotRow = normalizeBotRow;
		exports.projectLegacyRow = projectLegacyRow;
		exports.rebaseDraft = rebaseDraft;
		exports.safeText = safeText;
		exports.splitLegacyFeishuMessageText = splitLegacyFeishuMessageText;
		exports.validateBotRows = validateBotRows;
		return module.exports;
	}
});

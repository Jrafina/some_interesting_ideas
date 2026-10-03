window.__ModuleLoader__.load({
	id: "dsh-expense-recodes",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let React = require("react");
		// ---------------------------------------------------------------------
		// dsh-expense-recodes — client half
		//
		// 1) 价格自定义：输入缓存命中价 / 输入缓存未命中价 / 输出价（单位：元 / 百万 tokens），
		//    通过悬浮小窗的 ⚙ 设置窗或「设置 → 费用统计」页修改，localStorage 持久化。
		// 2) 数据来源：与界面底部统计行相同 —— 会话的 tokenUsage 投影
		//    (uncachedInputTokens / cacheReadTokens / cacheWriteTokens / outputTokens)
		//    而非抓取 DOM 文本，因此与界面显示天然一致、实时更新。
		// 3) 300×160 悬浮小窗实时显示当前工作区/会话的费用；会话作用域注册
		//    (conversation.composer.dock) 保证切换工作区时自动跟随切换显示。
		// ---------------------------------------------------------------------
		var NS = "dsh-expense-recodes";
		var STORAGE_KEY = NS + ".prices";
		/** 默认单价：缓存命中 ¥1 / 输入 ¥4 / 输出 ¥16（元 / 百万 tokens）。 */
		var PRICE_DEFAULTS = { cacheHit: 1, input: 4, output: 16 };
		/** 悬浮窗尺寸：300×160 像素。 */
		var WINDOW_WIDTH = 300;
		var WINDOW_HEIGHT = 160;

		// ---------------------------------------------------------------
		// 价格存取（localStorage 持久化）
		// ---------------------------------------------------------------
		function sanitizePrice(value, fallback) {
			var n = Number(value);
			return Number.isFinite(n) && n >= 0 ? n : fallback;
		}
		function loadPrices() {
			try {
				var raw = window.localStorage.getItem(STORAGE_KEY);
				if (raw) {
					var parsed = JSON.parse(raw);
					return {
						cacheHit: sanitizePrice(parsed.cacheHit, PRICE_DEFAULTS.cacheHit),
						input: sanitizePrice(parsed.input, PRICE_DEFAULTS.input),
						output: sanitizePrice(parsed.output, PRICE_DEFAULTS.output)
					};
				}
			} catch (err) {
				// localStorage 不可用（隐私模式等）时静默回退默认值
			}
			return Object.assign({}, PRICE_DEFAULTS);
		}
		function savePrices(prices) {
			try {
				window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prices));
			} catch (err) {
				// ignore: quota / private mode
			}
		}
		function createPriceStore() {
			var prices = loadPrices();
			var listeners = new Set();
			return {
				get: function () { return prices; },
				set: function (next) {
					prices = {
						cacheHit: sanitizePrice(next.cacheHit, PRICE_DEFAULTS.cacheHit),
						input: sanitizePrice(next.input, PRICE_DEFAULTS.input),
						output: sanitizePrice(next.output, PRICE_DEFAULTS.output)
					};
					savePrices(prices);
					listeners.forEach(function (fn) { fn(prices); });
				},
				reset: function () {
					prices = Object.assign({}, PRICE_DEFAULTS);
					savePrices(prices);
					listeners.forEach(function (fn) { fn(prices); });
				},
				subscribe: function (fn) {
					listeners.add(fn);
					return function () { listeners.delete(fn); };
				}
			};
		}

		// ---------------------------------------------------------------
		// 费用计算
		// ---------------------------------------------------------------
		/**
		 * 由 tokenUsage 投影计算费用明细（显示口径）：
		 *   输入缓存未命中 tokens = uncachedInputTokens + cacheWriteTokens
		 *   输入缓存命中 tokens   = cacheReadTokens
		 *   输出 tokens           = outputTokens
		 *   缓存命中率            = cacheReadTokens / (输入缓存未命中 + 输入缓存命中)
		 *   本会话总费用          = 输入缓存未命中 tokens × 输入价
		 *                          + 输入缓存命中 tokens × 缓存命中价
		 *                          + 输出 tokens × 输出价
		 */
		function computeBilling(usage, prices) {
			if (!usage || typeof usage !== "object") return null;
			var cacheRead = Number(usage.cacheReadTokens) || 0;
			var cacheWrite = Number(usage.cacheWriteTokens) || 0;
			var uncached = Number(usage.uncachedInputTokens) || 0;
			var output = Number(usage.outputTokens) || 0;
			var input = uncached + cacheWrite;
			var billedInput = input + cacheRead;
			if (billedInput <= 0 && output <= 0) return null;
			var cacheRate = billedInput > 0 ? cacheRead / billedInput : 0;
			var yuan = function (tokens, pricePerM) { return tokens * pricePerM / 1e6; };
			return {
				input: input,
				output: output,
				cacheRead: cacheRead,
				cacheWrite: cacheWrite,
				cacheRate: cacheRate,
				cacheCost: yuan(cacheRead, prices.cacheHit),
				inputCost: yuan(input, prices.input),
				outputCost: yuan(output, prices.output),
				total: yuan(cacheRead, prices.cacheHit) + yuan(input, prices.input) + yuan(output, prices.output)
			};
		}
		/** 与界面一致的紧凑 token 数格式化（K / M）。 */
		function formatTokens(n) {
			if (n < 1e3) return String(n);
			var scaled = function (v) { return v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10); };
			if (n < 1e6) return scaled(n / 1e3) + "K";
			return scaled(n / 1e6) + "M";
		}
		/** 金额格式化：¥ + 最多 4 位小数（去尾零）。 */
		function formatMoney(v) {
			if (!Number.isFinite(v)) return "\u00a5\u2014";
			var text = v.toFixed(4).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
			return "\u00a5" + text;
		}
		/** 百分比格式化（最多 2 位小数）。 */
		function formatPercent(rate) {
			if (!Number.isFinite(rate)) return "\u2014";
			var pct = rate * 100;
			var text = pct.toFixed(2).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
			return text + "%";
		}

		// ---------------------------------------------------------------
		// 多语言
		// ---------------------------------------------------------------
		var zh = {
			windowTitle: "费用统计",
			inputTokens: "输入缓存未命中 tokens",
			cacheHit: "输入缓存命中 tokens",
			outputTokens: "输出 tokens",
			cacheRate: "缓存命中率",
			totalCost: "本会话总费用",
			subtotal: "小计",
			settingsNav: "费用统计",
			settingsTitle: "费用统计设置",
			settingsDesc: "按“元 / 百万 tokens（M）”设置单价，用于实时折算当前会话的调用费用。",
			priceCacheHit: "输入缓存命中价",
			priceInput: "输入缓存未命中价",
			priceOutput: "输出价",
			priceUnit: "元 / M tokens",
			save: "保存",
			saved: "已保存",
			reset: "恢复默认",
			minimize: "收起",
			restore: "展开",
			close: "关闭",
			settings: "设置",
			noUsage: "暂无用量数据",
			currency: "\u00a5"
		};
		var en = {
			windowTitle: "Cost Stats",
			inputTokens: "Input cache-miss tokens",
			cacheHit: "Input cache-hit tokens",
			outputTokens: "Output tokens",
			cacheRate: "Cache hit rate",
			totalCost: "Session total cost",
			subtotal: "Cost",
			settingsNav: "Cost Stats",
			settingsTitle: "Cost Stats Settings",
			settingsDesc: "Set prices in \u00a5 / 1M tokens to estimate the current session cost in real time.",
			priceCacheHit: "Cache-hit input price",
			priceInput: "Cache-miss input price",
			priceOutput: "Output price",
			priceUnit: "\u00a5 / M tokens",
			save: "Save",
			saved: "Saved",
			reset: "Reset defaults",
			minimize: "Minimize",
			restore: "Expand",
			close: "Close",
			settings: "Settings",
			noUsage: "No usage yet",
			currency: "\u00a5"
		};
		var localeService = null;
		function attachLocale(service) {
			localeService = service;
		}
		function activeLocale() {
			return localeService && typeof localeService.getSnapshot === "function"
				? localeService.getSnapshot().active
				: (typeof navigator !== "undefined" ? navigator.language : "") || "en";
		}
		/** 按当前语言取文案。 */
		function t(key) {
			var dict = activeLocale().toLowerCase().startsWith("zh") ? zh : en;
			return dict[key] !== void 0 ? dict[key] : key;
		}
		function dictFor(locale) {
			return String(locale).toLowerCase().startsWith("zh") ? zh : en;
		}

		// ---------------------------------------------------------------
		// 共享样式（跟随 DSH 主题变量）
		// ---------------------------------------------------------------
		var styles = {
			window: {
				position: "fixed",
				width: WINDOW_WIDTH + "px",
				height: WINDOW_HEIGHT + "px",
				zIndex: 100,
				background: "var(--dsw-alias-bg-base)",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: "10px",
				boxShadow: "var(--dsw-shadow-lv3)",
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
				fontSize: "12px",
				color: "var(--dsw-alias-label-primary)",
				userSelect: "none"
			},
			header: {
				display: "flex",
				alignItems: "center",
				gap: "6px",
				padding: "6px 8px",
				background: "var(--dsw-alias-interactive-bg-hover)",
				cursor: "grab",
				flex: "none"
			},
			headerTitle: {
				fontWeight: 600,
				flex: "1",
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			iconButton: {
				width: "22px",
				height: "22px",
				display: "grid",
				placeItems: "center",
				border: "none",
				borderRadius: "6px",
				background: "transparent",
				color: "var(--dsw-alias-label-secondary)",
				cursor: "pointer",
				fontSize: "12px",
				lineHeight: 1,
				padding: 0
			},
			row: {
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				gap: "10px",
				padding: "0px 10px",
				lineHeight: "17px"
			},
			rowLabel: {
				color: "var(--dsw-alias-label-secondary)",
				flex: "none"
			},
			rowValue: {
				fontVariantNumeric: "tabular-nums",
				textAlign: "right"
			},
			total: {
				marginTop: "auto",
				padding: "5px 10px",
				borderTop: "1px solid var(--dsw-alias-border-l1)",
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				fontWeight: 600
			},
			totalValue: {
				fontVariantNumeric: "tabular-nums",
				color: "var(--dsw-alias-label-primary)"
			},
			settingsWindow: {
				position: "fixed",
				width: "300px",
				zIndex: 101,
				background: "var(--dsw-alias-bg-base)",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: "10px",
				boxShadow: "var(--dsw-shadow-lv3)",
				display: "flex",
				flexDirection: "column",
				gap: "8px",
				padding: "10px",
				fontSize: "12px",
				color: "var(--dsw-alias-label-primary)"
			},
			field: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: "8px"
			},
			label: {
				color: "var(--dsw-alias-label-secondary)",
				flex: "none"
			},
			input: {
				width: "110px",
				padding: "3px 6px",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: "6px",
				background: "var(--dsw-alias-bg-base)",
				color: "var(--dsw-alias-label-primary)",
				fontSize: "12px",
				textAlign: "right"
			},
			actions: {
				display: "flex",
				justifyContent: "flex-end",
				gap: "8px"
			},
			button: {
				padding: "3px 12px",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: "6px",
				background: "var(--dsw-alias-button-floating-fill)",
				color: "var(--dsw-alias-label-primary)",
				cursor: "pointer",
				fontSize: "12px"
			},
			primaryButton: {
				padding: "3px 12px",
				border: "none",
				borderRadius: "6px",
				background: "var(--dsw-alias-button-primary-fill)",
				color: "var(--dsw-alias-label-primary-inverted)",
				cursor: "pointer",
				fontSize: "12px",
				fontWeight: 600
			},
			chip: {
				position: "fixed",
				right: "16px",
				bottom: "88px",
				zIndex: 100,
				display: "flex",
				alignItems: "center",
				gap: "6px",
				padding: "4px 10px",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: "999px",
				background: "var(--dsw-alias-bg-base)",
				boxShadow: "var(--dsw-shadow-lv3)",
				color: "var(--dsw-alias-label-primary)",
				fontSize: "12px",
				cursor: "pointer"
			}
		};

		// ---------------------------------------------------------------
		// 组件：定价表单（悬浮设置窗与「设置 → 费用统计」页共用）
		// ---------------------------------------------------------------
		function PriceForm(props) {
			var store = props.store;
			var prices = React.useSyncExternalStore(store.subscribe, store.get);
			var initialDraft = React.useMemo(function () {
				return { cacheHit: String(prices.cacheHit), input: String(prices.input), output: String(prices.output) };
			}, []);
			var draftState = React.useState(initialDraft);
			var draft = draftState[0];
			var setDraft = draftState[1];
			var savedState = React.useState(false);
			var saved = savedState[0];
			var setSaved = savedState[1];
			var update = function (key) {
				return function (e) {
					var value = e.target.value;
					setDraft(Object.assign({}, draft, { [key]: value }));
					if (saved) setSaved(false);
				};
			};
			var onSave = function () {
				store.set({
					cacheHit: sanitizePrice(draft.cacheHit, prices.cacheHit),
					input: sanitizePrice(draft.input, prices.input),
					output: sanitizePrice(draft.output, prices.output)
				});
				setDraft({
					cacheHit: String(sanitizePrice(draft.cacheHit, prices.cacheHit)),
					input: String(sanitizePrice(draft.input, prices.input)),
					output: String(sanitizePrice(draft.output, prices.output))
				});
				setSaved(true);
			};
			var onReset = function () {
				store.reset();
				setDraft({ cacheHit: String(PRICE_DEFAULTS.cacheHit), input: String(PRICE_DEFAULTS.input), output: String(PRICE_DEFAULTS.output) });
				setSaved(true);
			};
			return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } },
				React.createElement("div", { style: styles.field },
					React.createElement("span", { style: styles.label }, t("priceCacheHit")),
					React.createElement("input", {
						style: styles.input,
						type: "number",
						min: "0",
						step: "0.1",
						value: draft.cacheHit,
						onChange: update("cacheHit")
					})),
				React.createElement("div", { style: styles.field },
					React.createElement("span", { style: styles.label }, t("priceInput")),
					React.createElement("input", {
						style: styles.input,
						type: "number",
						min: "0",
						step: "0.1",
						value: draft.input,
						onChange: update("input")
					})),
				React.createElement("div", { style: styles.field },
					React.createElement("span", { style: styles.label }, t("priceOutput")),
					React.createElement("input", {
						style: styles.input,
						type: "number",
						min: "0",
						step: "0.1",
						value: draft.output,
						onChange: update("output")
					})),
				React.createElement("div", { style: styles.actions },
					React.createElement("button", { style: styles.button, type: "button", onClick: onReset }, t("reset")),
					React.createElement("button", { style: styles.primaryButton, type: "button", onClick: onSave }, saved ? t("saved") : t("save"))));
		}

		// ---------------------------------------------------------------
		// 组件：悬浮费用窗口（300×160）
		// ---------------------------------------------------------------
		function CostWindow(props) {
			var useProjection = props.useProjection;
			var store = props.store;
			var prices = React.useSyncExternalStore(store.subscribe, store.get);
			var usage = typeof useProjection === "function" ? useProjection("tokenUsage") : void 0;
			var billing = React.useMemo(function () { return computeBilling(usage, prices); }, [usage, prices]);

			var hiddenState = React.useState(false);
			var hidden = hiddenState[0];
			var setHidden = hiddenState[1];
			var settingsState = React.useState(false);
			var showSettings = settingsState[0];
			var setShowSettings = settingsState[1];
			// 拖拽：pos 为 null 时使用默认右下角位置
			var posState = React.useState(null);
			var pos = posState[0];
			var setPos = posState[1];
			var dragState = React.useState(null);
			var drag = dragState[0];
			var setDrag = dragState[1];
			// 拖拽基准必须取“小窗本体”的位置（windowRef）：包裹用的零高度容器
			// 位于 dock 布局处且位置恒定，若以它为基准，每次拖拽都会从原始位置起跳。
			var containerRef = React.useRef(null);
			var windowRef = React.useRef(null);

			React.useEffect(function () {
				if (drag === null) return;
				var onMove = function (ev) {
					setPos({
						left: drag.left + (ev.clientX - drag.startX),
						top: drag.top + (ev.clientY - drag.startY)
					});
				};
				var onUp = function () { setDrag(null); };
				window.addEventListener("mousemove", onMove);
				window.addEventListener("mouseup", onUp);
				return function () {
					window.removeEventListener("mousemove", onMove);
					window.removeEventListener("mouseup", onUp);
				};
			}, [drag]);

			var onHeaderDown = function (e) {
				if (e.button !== 0) return;
				// 标题栏按钮（⚙ / – / ×）的 mousedown 会冒泡到这里，若不拦截，
				// 点按钮时会误触发拖拽：点开设置窗后鼠标移向“保存”的途中，小窗已被拖着走，
				// 松手后设置窗恰好盖住它，导致“不能移动、也不能叉掉”。
				if (typeof e.target.closest === "function" && e.target.closest("button") !== null) return;
				var el = windowRef.current;
				if (el === null) return;
				var rect = el.getBoundingClientRect();
				// 以上一次拖拽后的位置为新起点；若尚未拖拽过则取窗口当前的实际位置，
				// 保证连续拖拽不回到原始位置。
				setDrag({
					startX: e.clientX,
					startY: e.clientY,
					left: pos !== null ? pos.left : rect.left,
					top: pos !== null ? pos.top : rect.top
				});
			};

			var windowStyle = Object.assign({}, styles.window,
				pos === null ? { right: "16px", bottom: "88px" } : { left: pos.left + "px", top: pos.top + "px" });

			if (hidden) {
				return React.createElement("button", {
					type: "button",
					style: styles.chip,
					onClick: function () { setHidden(false); },
					title: t("restore")
				}, React.createElement("span", null, "\u03a3"), React.createElement("span", null, billing !== null ? formatMoney(billing.total) : t("noUsage")));
			}

			return React.createElement("div", {
				ref: containerRef,
				style: { height: 0, overflow: "visible" }
			},
				React.createElement("div", { ref: windowRef, style: windowStyle },
					// 标题栏（可拖拽）
					React.createElement("div", {
						style: styles.header,
						onMouseDown: onHeaderDown
					},
						React.createElement("span", { style: styles.headerTitle }, t("windowTitle")),
						React.createElement("button", {
							type: "button",
							style: styles.iconButton,
							title: t("settings"),
							onClick: function (e) { e.stopPropagation(); setShowSettings(!showSettings); }
						}, "\u2699"),
						React.createElement("button", {
							type: "button",
							style: styles.iconButton,
							title: t("minimize"),
							onClick: function (e) { e.stopPropagation(); setHidden(true); }
						}, "\u2013"),
						React.createElement("button", {
							type: "button",
							style: styles.iconButton,
							title: t("close"),
							onClick: function (e) { e.stopPropagation(); setHidden(true); }
						}, "\u00d7")),
					// 数据区
					billing === null
						? React.createElement("div", { style: { padding: "12px", color: "var(--dsw-alias-label-tertiary)", textAlign: "center", flex: "1", display: "grid", placeItems: "center" } }, t("noUsage"))
						: React.createElement("div", { style: { flex: "1", display: "flex", flexDirection: "column", paddingTop: "2px", overflow: "hidden" } },
							React.createElement("div", { style: styles.row },
								React.createElement("span", { style: styles.rowLabel }, t("inputTokens")),
								React.createElement("span", { style: styles.rowValue },
									formatTokens(billing.input),
									"  ",
									React.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)" } }, "(" + formatMoney(billing.inputCost) + ")"))),
							React.createElement("div", { style: styles.row },
								React.createElement("span", { style: styles.rowLabel }, t("cacheHit")),
								React.createElement("span", { style: styles.rowValue },
									formatTokens(billing.cacheRead),
									"  ",
									React.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)" } }, "(" + formatMoney(billing.cacheCost) + ")"))),
							React.createElement("div", { style: styles.row },
								React.createElement("span", { style: styles.rowLabel }, t("outputTokens")),
								React.createElement("span", { style: styles.rowValue },
									formatTokens(billing.output),
									"  ",
									React.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)" } }, "(" + formatMoney(billing.outputCost) + ")"))),
							React.createElement("div", { style: styles.row },
								React.createElement("span", { style: styles.rowLabel }, t("cacheRate")),
								React.createElement("span", { style: styles.rowValue },
									React.createElement("span", { style: { color: "var(--dsw-alias-label-primary)" } }, formatPercent(billing.cacheRate)))),
							React.createElement("div", { style: styles.total },
								React.createElement("span", null, t("totalCost")),
								React.createElement("span", { style: styles.totalValue }, formatMoney(billing.total)))),
					// 定价设置小窗（由 ⚙ 切换）
					showSettings
						? React.createElement("div", {
							style: Object.assign({}, styles.settingsWindow, pos === null ? { right: "16px", bottom: (88 + WINDOW_HEIGHT + 8) + "px" } : { left: pos.left + "px", top: (pos.top - 8 - 170) + "px" })
						},
							React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } },
								React.createElement("div", { style: { fontWeight: 600 } }, t("settingsTitle")),
								React.createElement("button", {
									type: "button",
									style: styles.iconButton,
									title: t("close"),
									onClick: function (e) { e.stopPropagation(); setShowSettings(false); }
								}, "\u00d7")),
							React.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", lineHeight: "16px" } }, t("settingsDesc")),
							React.createElement(PriceForm, { store: store }))
						: null));
		}

		// ---------------------------------------------------------------
		// 组件：「设置 → 费用统计」页
		// ---------------------------------------------------------------
		function PricesSection(props) {
			return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "12px", padding: "8px 0" } },
				React.createElement("div", null,
					React.createElement("div", { style: { fontWeight: 600, fontSize: "14px", marginBottom: "4px" } }, t("settingsTitle")),
					React.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px" } }, t("settingsDesc"))),
				React.createElement(PriceForm, { store: props.store }));
		}

		// ---------------------------------------------------------------
		// 插件定义
		// ---------------------------------------------------------------
		const inject = ["slots", "locale"];
		function apply(ctx) {
			attachLocale(ctx.locale);
			const store = createPriceStore();
			ctx.effect(() => {
				const offZh = ctx.locale.register(NS, "zh", zh);
				const offEn = ctx.locale.register(NS, "en", en);
				return () => { offZh(); offEn(); };
			}, "dsh-expense-recodes: dictionaries");
			// 悬浮费用窗口：注册在界面底部统计行所在的会话作用域槽位，
			// 切换工作区/会话时自动跟随显示对应会话的费用。
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "dsh-expense-recodes",
				order: 100,
				locale: NS
			}, (props) => React.createElement(CostWindow, Object.assign({ store }, props))));
			// 定价设置页：满足“自定义价格”的自定义窗口（也可从悬浮窗 ⚙ 打开）。
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "dsh-expense-recodes",
				order: 200,
				label: () => t("settingsNav")
			}, (props) => React.createElement(PricesSection, Object.assign({ store }, props))));
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
// Verbatim excerpt of the published `@michengai/dsh-codex-ui@2.0.19`
// `lib/client.js` — the shape dsh rc.1 ships. Do not "tidy" it: the applier's
// anchors are exact strings from this file, so an edit here is a different
// bundle shape and the test stops proving anything about rc.1.
//
// Taken from the tarball `npm pack @michengai/dsh-codex-ui@2.0.19`:
//   lines 7605-7668  the sidebar-layout model (FIXED_PANEL_IDS, parseLayout,
//                    serializeLayout, isFixed, normalizeLayout)
//   lines 7838-7846  the layout effect inside `SidebarNav` that normalizes the
//                    saved layout against the registered panels
// The two regions are joined by the smallest wrapper that parses; the code
// between them in the real bundle is unrelated to the patch.
const react = {
  useEffect() {},
  useRef: (value) => ({ current: value }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
};

		/**
		* 侧栏导航布局模型：
		* 只保存「常驻顺序」与「收入更多的顺序」，入口本身仍由宿主注册与渲染。
		* 纯函数，方便单测；不读写 localStorage。
		*/
		/** 宿主固定的入口：始终常驻，不参与收纳与拖动。 */
		const FIXED_PANEL_IDS = ["plugins"];
		const SIDEBAR_LAYOUT_KEY = "michengai.codex-ui.sidebar-layout.v1";
		const isStringArray$1 = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
		/** 解析持久化内容；格式不符时返回 undefined，由调用方回退默认布局。 */
		function parseLayout(raw) {
			if (raw === null || raw === "") return void 0;
			try {
				const data = JSON.parse(raw);
				if (typeof data !== "object" || data === null) return void 0;
				const { pinned, more } = data;
				if (!isStringArray$1(pinned) || !isStringArray$1(more)) return void 0;
				return {
					pinned,
					more
				};
			} catch {
				return;
			}
		}
		function serializeLayout(layout) {
			return JSON.stringify({
				pinned: layout.pinned,
				more: layout.more
			});
		}
		const isFixed = (id) => FIXED_PANEL_IDS.includes(id);
		/**
		* 把已保存布局与当前实际注册的入口对齐：
		* - 固定入口由宿主恒定渲染，不写入布局数据；
		* - 保存过但已消失的入口丢弃；
		* - 新出现的入口追加到更多末尾，不打断用户已有顺序；
		* - 同一入口不会同时出现在两个分区。
		*/
		function normalizeLayout(saved, availableIds) {
			const available = new Set(availableIds.filter((id) => !isFixed(id)));
			const seen = /* @__PURE__ */ new Set();
			const pinned = [];
			for (const id of saved?.pinned ?? []) {
				if (!available.has(id) || seen.has(id)) continue;
				seen.add(id);
				pinned.push(id);
			}
			const more = [];
			for (const id of saved?.more ?? []) {
				if (!available.has(id) || seen.has(id)) continue;
				seen.add(id);
				more.push(id);
			}
			for (const id of availableIds) {
				if (isFixed(id) || seen.has(id)) continue;
				seen.add(id);
				more.push(id);
			}
			return {
				pinned,
				more
			};
		}
const SidebarNav = (props) => {
  const availableIds = props.availableIds;
  const [layout, setLayout] = react.useState();
			const layoutRef = (0, react.useRef)(layout);
			layoutRef.current = layout;
			(0, react.useEffect)(() => {
				setLayout((prev) => {
					const next = normalizeLayout(prev, availableIds);
					if (next.pinned.length === prev.pinned.length && next.more.length === prev.more.length && next.pinned.every((id, i) => id === prev.pinned[i]) && next.more.every((id, i) => id === prev.more[i])) return prev;
					return next;
				});
			}, [availableIds]);
  return null;
};


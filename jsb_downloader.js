// ==UserScript==
// @name         菁师帮 文档下载捕获器
// @namespace    https://www.jingshibang.com/
// @version      2.0
// @description  捕获 filepreview 接口地址并通过浏览器下载（PDF/WORD）；跨页面/跨标签页累进收集（localStorage 共享 + 实时同步）、一键全部下载、文件名规范化（区分答案版/学生版）、单条复制/删除、快捷键 Alt(⌥)+A 全部 / +D 最近一个 / +H 收起面板
// @match        https://www.jingshibang.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'jsb_dl_captured_v1';
  const MAX_ITEMS = 100;
  const captured = []; // {url, name, type}，内容会与 localStorage 保持同步

  // macOS 上 Alt 即 Option(⌥)；按键判断用 e.code 而非 e.key（Option+字母在 mac 会变成特殊字符）
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  const ALT_LABEL = IS_MAC ? '⌥' : 'Alt+';

  // ---- 持久化（同源所有标签页共享，刷新不丢）----
  function load() {
    let arr = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      arr = raw ? JSON.parse(raw) : [];
    } catch (e) { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    captured.length = 0;          // 原地替换，保持 captured 引用不变
    captured.push.apply(captured, arr);
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(captured)); } catch (e) {}
  }

  // ---- 文件名规范化 ----
  function sanitize(name) {
    // 去掉文件系统非法字符，压缩多余空白
    return name.replace(/[\\/:*?"<>|\r\n\t]+/g, '_').replace(/\s+/g, ' ').trim();
  }

  function fileNameFromUrl(url) {
    try {
      const u = new URL(url, location.href);
      const fp = u.searchParams.get('filepath') || '';
      const type = (u.searchParams.get('type') || '').toLowerCase();
      let base = decodeURIComponent(fp.split('/').pop() || '').trim();
      if (!base) base = 'document';

      // 拆出扩展名（.pdf / .docx 等），单独保留，避免标记被加到后缀后面
      let ext = '';
      const dot = base.lastIndexOf('.');
      if (dot > 0) {
        ext = base.slice(dot).toLowerCase();
        base = base.slice(0, dot);
      }

      base = sanitize(base);

      // 标记版本，避免学生版/答案版同名互相覆盖
      const tag = type === 'answer' ? '【答案版】'
                : type             ? '【' + type + '】'
                :                    '';

      return base + tag + ext;
    } catch (e) {
      return 'download';
    }
  }

  function record(url) {
    if (!url || url.indexOf('/api/public/filepreview') === -1) return;
    const abs = new URL(url, location.href).href;
    load();                                   // 先并入其它标签页可能已写入的数据
    if (captured.some(c => c.url === abs)) return;
    const name = fileNameFromUrl(abs);
    const type = (new URL(abs, location.href)).searchParams.get('type') || '';
    captured.unshift({ url: abs, name, type });
    if (captured.length > MAX_ITEMS) captured.length = MAX_ITEMS;
    save();
    renderPanel();
  }

  function removeItem(item) {
    load();
    const i = captured.findIndex(c => c.url === item.url);
    if (i !== -1) captured.splice(i, 1);
    save();
    renderPanel();
  }

  function clearAll() {
    if (captured.length && !confirm('清空已捕获的 ' + captured.length + ' 个链接？')) return;
    captured.length = 0;
    save();
    renderPanel();
  }

  // ---- 拦截 fetch ----
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url);
      record(url);
    } catch (e) {}
    return origFetch.apply(this, arguments);
  };

  // ---- 拦截 XMLHttpRequest ----
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { record(url); } catch (e) {}
    return origOpen.apply(this, arguments);
  };

  // ---- 通过浏览器下载 ----
  function download(item) {
    const a = document.createElement('a');
    a.href = item.url;
    a.download = item.name;          // 提示浏览器下载而非预览
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function downloadAll() {
    // 逐个间隔触发，避免浏览器把"批量下载"当成弹窗拦截
    captured.forEach((item, i) => {
      setTimeout(() => download(item), i * 600);
    });
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      // 兜底：旧接口或非安全上下文
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy') ? resolve() : reject(); }
      catch (e) { reject(e); }
      finally { ta.remove(); }
    });
  }

  // ---- 图标（Feather 风格，单色描边，随文字颜色变化）----
  const ICON = {
    copy:  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    check: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>'
  };

  function makeIconBtn(svg, title, hoverColor) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = title;
    b.innerHTML = svg;
    b.style.cssText = 'cursor:pointer;border:none;background:transparent;color:#999;' +
      'padding:3px;border-radius:4px;display:inline-flex;align-items:center;line-height:0;';
    b.onmouseenter = () => { b.style.background = '#f0f0f0'; b.style.color = hoverColor || '#555'; };
    b.onmouseleave = () => { b.style.background = 'transparent'; b.style.color = '#999'; };
    return b;
  }

  // ---- 浮动面板 ----
  let panel;
  function ensurePanel() {
    if (panel) return panel;
    if (!document.body) return null;           // body 还没就绪，DOMContentLoaded 后会再渲染
    panel = document.createElement('div');
    panel.id = 'jsb-dl-panel';
    Object.assign(panel.style, {
      position: 'fixed', right: '16px', bottom: '16px', zIndex: 999999,
      background: '#fff', border: '1px solid #ddd', borderRadius: '8px',
      boxShadow: '0 4px 16px rgba(0,0,0,.15)', padding: '10px 12px',
      font: '13px/1.5 sans-serif', maxWidth: '360px', color: '#333'
    });
    document.body.appendChild(panel);
    return panel;
  }

  function renderPanel() {
    const p = ensurePanel();
    if (!p) return;
    if (!captured.length) { p.style.display = 'none'; return; }
    p.style.display = 'block';
    p.innerHTML = '';

    // 头部：标题 + 全部下载 + 清空
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;';
    const title = document.createElement('span');
    title.textContent = '已捕获 ' + captured.length + ' 个链接';
    title.style.cssText = 'font-weight:600;white-space:nowrap;';

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;align-items:center;gap:6px;';
    const allBtn = document.createElement('button');
    allBtn.textContent = '全部下载 (' + ALT_LABEL + 'A)';
    allBtn.style.cssText = 'cursor:pointer;border:none;background:#0a9b54;color:#fff;border-radius:4px;padding:3px 10px;white-space:nowrap;';
    allBtn.onclick = downloadAll;
    const clearBtn = document.createElement('button');
    clearBtn.textContent = '清空';
    clearBtn.style.cssText = 'cursor:pointer;border:1px solid #ddd;background:#fff;color:#888;border-radius:4px;padding:3px 8px;white-space:nowrap;';
    clearBtn.onclick = clearAll;
    actions.appendChild(allBtn);
    actions.appendChild(clearBtn);

    head.appendChild(title);
    head.appendChild(actions);
    p.appendChild(head);

    // 列表（条数多时可滚动）
    const list = document.createElement('div');
    list.style.cssText = 'max-height:50vh;overflow-y:auto;';
    captured.forEach((item) => {
      const row = document.createElement('div');
      row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:6px;';
      const btn = document.createElement('button');
      btn.textContent = '下载';
      btn.style.cssText = 'cursor:pointer;border:none;background:#2a6cf0;color:#fff;border-radius:4px;padding:3px 10px;white-space:nowrap;';
      btn.onclick = () => download(item);
      const label = document.createElement('span');
      label.textContent = item.name;   // 版本标记已并入文件名，无需再单独显示 type
      label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      label.title = item.name;

      // 复制链接
      const copyBtn = makeIconBtn(ICON.copy, '复制链接', '#2a6cf0');
      copyBtn.onclick = () => {
        copyToClipboard(item.url).then(() => {
          copyBtn.innerHTML = ICON.check;
          copyBtn.title = '已复制';
          copyBtn.style.color = '#0a9b54';
          setTimeout(() => {
            copyBtn.innerHTML = ICON.copy;
            copyBtn.title = '复制链接';
            copyBtn.style.color = '#999';
          }, 1200);
        }).catch(() => { copyBtn.title = '复制失败'; });
      };

      // 删除该条
      const delBtn = makeIconBtn(ICON.trash, '从列表移除', '#e23a3a');
      delBtn.onclick = () => removeItem(item);

      row.appendChild(btn);
      row.appendChild(label);
      row.appendChild(copyBtn);
      row.appendChild(delBtn);
      list.appendChild(row);
    });
    p.appendChild(list);
  }

  // ---- 跨标签页实时同步 ----
  window.addEventListener('storage', function (e) {
    if (e.key === STORAGE_KEY) { load(); renderPanel(); }
  });

  // ---- 快捷键 ----
  // Alt/⌥ + A 全部下载 / +D 下载最近一个 / +H 显示隐藏面板
  // 用 e.code（物理键）判断：macOS 下 Option+字母 的 e.key 会变成 å/∂ 等特殊字符
  window.addEventListener('keydown', function (e) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    switch (e.code) {
      case 'KeyA':
        e.preventDefault();
        downloadAll();
        break;
      case 'KeyD':
        e.preventDefault();
        if (captured[0]) download(captured[0]);
        break;
      case 'KeyH':
        e.preventDefault();
        if (panel) panel.style.display = (panel.style.display === 'none') ? 'block' : 'none';
        break;
    }
  }, true);

  // ---- 启动：载入已累积的列表并渲染（让面板在任意页面都能出现）----
  function init() {
    load();
    renderPanel();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

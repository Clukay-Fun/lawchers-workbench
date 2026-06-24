import { useEffect, useMemo, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';
import { getDocument, GlobalWorkerOptions, Util } from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

function sensitiveTerms(material) {
  const automatic = (material?.entities || [])
    .filter((entity) => entity.original)
    .map((entity) => ({ text: entity.original, replacement: entity.replacement || '***', manual: false }));
  const manual = (material?.manualRedactions || []).map((item) => ({
    text: typeof item === 'string' ? item : item.text,
    replacement: '***',
    manual: true,
  }));
  const unique = new Map();
  [...automatic, ...manual]
    .filter((term) => term.text)
    .sort((a, b) => b.text.length - a.text.length)
    .forEach((term) => unique.set(term.text, term));
  return [...unique.values()];
}

function applyRedactionsToDom(root, terms) {
  const candidates = terms
    .map((term) => ({ match: term.text, replacement: term.replacement || '***' }))
    .filter((c) => c.match)
    .sort((a, b) => b.match.length - a.match.length);
  if (!candidates.length) return;

  // 1. 收集文本节点（跳过空白与已脱敏区域）
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segs = []; // { node, start, end }
  let full = '';
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.data || node.parentElement?.closest('.redaction-mark')) continue;
    const start = full.length;
    full += node.data;
    segs.push({ node, start, end: full.length });
  }
  if (!segs.length) return;

  // 2. 在拼接后的全文里按全局偏移定位命中区间（最长优先、不重叠、可跨节点）
  const taken = new Array(full.length).fill(false);
  const ranges = []; // { start, end, replacement }
  for (const cand of candidates) {
    let from = 0;
    while (from <= full.length - cand.match.length) {
      const idx = full.indexOf(cand.match, from);
      if (idx < 0) break;
      let free = true;
      for (let i = idx; i < idx + cand.match.length; i += 1) { if (taken[i]) { free = false; break; } }
      if (free) {
        for (let i = idx; i < idx + cand.match.length; i += 1) taken[i] = true;
        ranges.push({ start: idx, end: idx + cand.match.length, replacement: cand.replacement });
        from = idx + cand.match.length;
      } else {
        from = idx + 1;
      }
    }
  }
  if (!ranges.length) return;
  ranges.sort((a, b) => a.start - b.start);

  // 3. 逐节点按与命中区间的交集切分包裹；跨节点时替换文本只放在起始节点，后续节点的原文丢弃
  for (const seg of segs) {
    const overlaps = ranges.filter((r) => r.start < seg.end && r.end > seg.start);
    if (!overlaps.length) continue;
    const frag = document.createDocumentFragment();
    let cursor = seg.start;
    for (const r of overlaps) {
      const s = Math.max(r.start, seg.start);
      const e = Math.min(r.end, seg.end);
      if (s > cursor) frag.append(document.createTextNode(full.slice(cursor, s)));
      if (r.start >= seg.start) {
        // 区间从本节点开始：放置脱敏替换文本
        const mark = document.createElement('span');
        mark.className = 'redaction-mark';
        mark.textContent = r.replacement;
        frag.append(mark);
      }
      // 否则为跨节点续段：直接丢弃这段原文（不渲染），避免重复掩码
      cursor = e;
    }
    if (cursor < seg.end) frag.append(document.createTextNode(full.slice(cursor, seg.end)));
    seg.node.replaceWith(frag);
  }
}

function DocxCanvas({ url, mode, terms }) {
  const containerRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      setError('');
      const container = containerRef.current;
      if (!container || !url) return;
      container.replaceChildren();
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('无法读取 DOCX 原件');
        const blob = await response.blob();
        await renderAsync(blob, container, container, {
          className: 'lawchers-docx',
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
        });
        if (!cancelled && mode === 'redacted') applyRedactionsToDom(container, terms);
      } catch (renderError) {
        if (!cancelled) setError(renderError.message || 'DOCX 预览失败');
      }
    };
    render();
    return () => { cancelled = true; };
  }, [url, mode, terms]);

  return error ? <div className="document-error">{error}</div> : <div className="docx-canvas" ref={containerRef} />;
}

function PdfCanvas({ url, mode, terms }) {
  const containerRef = useRef(null);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1); // 100% = 舒适大小（适应宽度的一半）；200% = 铺满宽度

  useEffect(() => {
    let cancelled = false;
    let loadingTask;
    const render = async () => {
      const container = containerRef.current;
      if (!container || !url) return;
      container.replaceChildren();
      setError('');
      try {
        const data = await fetch(url).then((response) => {
          if (!response.ok) throw new Error('无法读取 PDF 原件');
          return response.arrayBuffer();
        });
        loadingTask = getDocument({ data, verbosity: 0 });
        const pdf = await loadingTask.promise;
        for (let pageNumber = 1; pageNumber <= pdf.numPages && !cancelled; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          // 按容器宽度自适应：页面铺满可用宽度（封顶 980px），不再固定放大比例
          const baseViewport = page.getViewport({ scale: 1 });
          const available = Math.min(container.clientWidth || 800, 980);
          const fitScale = Math.max(0.5, available / baseViewport.width);
          // 舒适大小（适应宽度的一半）记为 100% (zoom=1)；200% (zoom=2) 即铺满宽度
          const viewport = page.getViewport({ scale: fitScale * 0.5 * zoom });
          const outputScale = window.devicePixelRatio || 1;
          const pageElement = document.createElement('section');
          pageElement.className = 'pdf-page';
          pageElement.style.width = `${viewport.width}px`;
          pageElement.style.height = `${viewport.height}px`;

          const canvas = document.createElement('canvas');
          // 按设备像素比放大位图分辨率，避免 retina 屏拉伸模糊
          canvas.width = Math.floor(viewport.width * outputScale);
          canvas.height = Math.floor(viewport.height * outputScale);
          canvas.setAttribute('aria-label', `PDF 第 ${pageNumber} 页`);
          pageElement.append(canvas);

          const textLayer = document.createElement('div');
          textLayer.className = 'pdf-text-layer';
          pageElement.append(textLayer);
          container.append(pageElement);

          const renderTransform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
          await page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: renderTransform }).promise;
          const textContent = await page.getTextContent();
          const normalizedPositions = [];
          let pageText = '';
          textContent.items.forEach((item, index) => {
            [...(item.str || '')].forEach((character, characterIndex) => {
              if (/\s/.test(character)) return;
              pageText += character;
              normalizedPositions.push({ itemIndex: index, characterIndex });
            });
          });
          const markedCharacters = new Map();
          if (mode === 'redacted') {
            for (const term of terms) {
              const normalizedTerm = term.text.replace(/\s/g, '');
              if (!normalizedTerm) continue;
              let from = 0;
              while (from < pageText.length) {
                const start = pageText.indexOf(normalizedTerm, from);
                if (start < 0) break;
                const end = start + normalizedTerm.length;
                for (let characterIndex = start; characterIndex < end; characterIndex += 1) {
                  const position = normalizedPositions[characterIndex];
                  if (!position) continue;
                  if (!markedCharacters.has(position.itemIndex)) markedCharacters.set(position.itemIndex, new Set());
                  markedCharacters.get(position.itemIndex).add(position.characterIndex);
                }
                from = end;
              }
            }
          }
          textContent.items.forEach((item, itemIndex) => {
            if (!item.str) return;
            const transform = Util.transform(viewport.transform, item.transform);
            const fontHeight = Math.hypot(transform[2], transform[3]);
            const angle = Math.atan2(transform[1], transform[0]);
            const span = document.createElement('span');
            span.textContent = item.str;
            span.style.left = `${transform[4]}px`;
            span.style.top = `${transform[5] - fontHeight}px`;
            span.style.fontSize = `${fontHeight}px`;
            span.style.transform = `rotate(${angle}rad)`;
            span.style.transformOrigin = '0 0';
            const sensitiveCharacterIndexes = markedCharacters.get(itemIndex);
            if (sensitiveCharacterIndexes?.size) {
              span.replaceChildren();
              let buffer = '';
              let bufferSensitive = null;
              const flush = () => {
                if (!buffer) return;
                const segment = document.createElement('span');
                if (bufferSensitive) {
                  segment.className = 'redaction-mark pdf-redaction-mark';
                  segment.textContent = '*'.repeat(Math.max(2, buffer.length));
                } else {
                  segment.textContent = buffer;
                }
                span.append(segment);
                buffer = '';
              };
              [...item.str].forEach((character, characterIndex) => {
                const isSensitive = sensitiveCharacterIndexes.has(characterIndex);
                if (bufferSensitive !== null && bufferSensitive !== isSensitive) flush();
                bufferSensitive = isSensitive;
                buffer += character;
              });
              flush();
            }
            textLayer.append(span);
          });
        }
      } catch (renderError) {
        if (!cancelled) setError(renderError.message || 'PDF 预览失败');
      }
    };
    render();
    return () => {
      cancelled = true;
      loadingTask?.destroy?.();
    };
  }, [url, mode, terms, zoom]);

  if (error) return <div className="document-error">{error}</div>;
  return (
    <>
      <div className="pdf-zoombar">
        <button onClick={() => setZoom((z) => Math.max(0.1, +(z - 0.1).toFixed(2)))} aria-label="缩小">−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))} aria-label="放大">＋</button>
        <button className="fit" onClick={() => setZoom(2)}>适应宽度</button>
      </div>
      <div className="pdf-canvas" ref={containerRef} />
    </>
  );
}

function TextCanvas({ material, mode, terms, onTextChange }) {
  const [sourceText, setSourceText] = useState('');
  useEffect(() => {
    if (material.workingText) {
      Promise.resolve().then(() => setSourceText(material.workingText));
      return undefined;
    }
    let cancelled = false;
    fetch(material.filePath)
      .then((response) => response.text())
      .then((text) => { if (!cancelled) setSourceText(text); })
      .catch(() => { if (!cancelled) setSourceText(material.redactedText || ''); });
    return () => { cancelled = true; };
  }, [material.filePath, material.redactedText, material.workingText]);

  if (mode === 'original') {
    return (
      <textarea
        className="text-document text-editor"
        value={sourceText}
        onChange={(event) => setSourceText(event.target.value)}
        onBlur={() => onTextChange(sourceText)}
        aria-label="文本工作副本"
      />
    );
  }
  const parts = [];
  let remaining = sourceText;
  let key = 0;
  while (remaining) {
    let earliest = null;
    for (const term of terms) {
      const index = remaining.indexOf(term.text);
      if (index >= 0 && (!earliest || index < earliest.index)) earliest = { index, term };
    }
    if (!earliest) {
      parts.push(<span key={`tail-${key}`}>{remaining}</span>);
      break;
    }
    if (earliest.index > 0) parts.push(<span key={key += 1}>{remaining.slice(0, earliest.index)}</span>);
    parts.push(<span className="redaction-mark" key={key += 1}>{earliest.term.replacement}</span>);
    remaining = remaining.slice(earliest.index + earliest.term.text.length);
  }
  return <pre className="text-document">{parts}</pre>;
}

export default function DocEditor({
  material,
  defaultView,
  onManualRedactionsChange,
  onTextChange,
  onReRedact,
  onExport,
  onRequestUpload,
  redacting,
  exporting,
}) {
  const viewportRef = useRef(null);
  const [mode, setMode] = useState(defaultView || 'redacted');
  const [selection, setSelection] = useState(null);
  const terms = useMemo(() => sensitiveTerms(material), [material]);

  const manualItems = material?.manualRedactions || [];

  const captureSelection = (event) => {
    // 两种模式都允许划词标注：在脱敏预览中标记后会即时被遮盖为高亮框
    if (event.target instanceof HTMLTextAreaElement) {
      const text = event.target.value.slice(event.target.selectionStart, event.target.selectionEnd).trim();
      if (!text || text.length > 500) {
        setSelection(null);
        return;
      }
      const rect = event.target.getBoundingClientRect();
      setSelection({ text, x: Math.min(rect.left + rect.width / 2, window.innerWidth - 180), y: Math.max(12, rect.top + 12) });
      return;
    }
    const nativeSelection = window.getSelection();
    const text = nativeSelection?.toString().trim();
    if (!text || text.length > 500 || !nativeSelection.rangeCount) {
      setSelection(null);
      return;
    }
    const range = nativeSelection.getRangeAt(0);
    if (!viewportRef.current?.contains(range.commonAncestorContainer)) return;
    const rect = range.getBoundingClientRect();
    setSelection({ text, x: Math.min(rect.left, window.innerWidth - 180), y: Math.max(12, rect.top - 48) });
  };

  const toggleManualSelection = async () => {
    if (!selection) return;
    const exists = manualItems.some((item) => (typeof item === 'string' ? item : item.text) === selection.text);
    const nextItems = exists
      ? manualItems.filter((item) => (typeof item === 'string' ? item : item.text) !== selection.text)
      : [...manualItems, selection.text];
    await onManualRedactionsChange(nextItems);
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  if (!material) {
    return (
      <section className="document-workspace empty-document">
        <div><strong>添加一份案件材料</strong><p>支持 DOCX、PDF、Markdown、TXT 与常见扫描件。</p><Button variant="default" onClick={onRequestUpload}>添加材料</Button></div>
      </section>
    );
  }

  const extension = (material.ext || material.name.split('.').pop() || '').toLowerCase().replace('.', '');
  const isDocx = extension === 'docx';
  const isPdf = extension === 'pdf';
  const isText = extension === 'txt' || extension === 'md';
  const isImage = ['png', 'jpg', 'jpeg', 'tiff', 'bmp'].includes(extension);

  return (
    <section className="document-workspace">
      <div className="document-toolbar">
        <div className="segmented-control compact">
          <button className={mode === 'original' ? 'active' : ''} onClick={() => setMode('original')}>原文</button>
          <button className={mode === 'redacted' ? 'active' : ''} onClick={() => setMode('redacted')}>脱敏预览</button>
        </div>
        <div className="document-toolbar-actions">
          <span className="annotation-count">{terms.length} 处标注</span>
          <Button variant="default" onClick={onExport} disabled={exporting}>{exporting ? '复检中…' : '导出'}</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="更多操作">•••</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={redacting} onClick={onReRedact} className="cursor-pointer">
                {redacting ? '正在重新识别…' : '重新识别敏感信息'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>
                人工标注 {manualItems.length} 处
              </DropdownMenuLabel>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="document-viewport" ref={viewportRef} onMouseUp={captureSelection}>
        {isDocx && <DocxCanvas url={mode === 'redacted' && material.redactedFileUrl ? material.redactedFileUrl : material.filePath} mode={mode} terms={terms} />}
        {isPdf && <PdfCanvas url={material.filePath} mode={mode} terms={terms} />}
        {isText && <TextCanvas material={material} mode={mode} terms={terms} onTextChange={onTextChange} />}
        {isImage && <div className="image-document"><img src={mode === 'redacted' && material.redactedFileUrl ? material.redactedFileUrl : material.filePath} alt="案件材料预览" /></div>}
        {!isDocx && !isPdf && !isText && !isImage && <div className="document-error">暂不支持预览该文件格式。</div>}
      </div>

      {!isImage && <div className="selection-hint">框选文字即可手动脱敏，标记后即时遮盖为高亮框</div>}
      {selection && (
        <div className="selection-popover flex items-center gap-1 text-white bg-foreground rounded-lg shadow-lg p-1" style={{ left: selection.x, top: selection.y }} onMouseDown={(e) => e.stopPropagation()}>
          {manualItems.some((item) => (typeof item === 'string' ? item : item.text) === selection.text) ? (
            <Button variant="ghost" onClick={() => toggleManualSelection()} className="text-white hover:bg-white/10 h-7 text-xs px-2.5 font-normal">
              取消标注
            </Button>
          ) : (
            <>
              <span className="text-[11px] text-[#7a8488] px-1.5 select-none">脱敏为</span>
              <Button variant="ghost" size="sm" onClick={() => toggleManualSelection('姓名')} className="text-white hover:bg-white/10 h-7 text-xs px-2 font-normal">姓名</Button>
              <Button variant="ghost" size="sm" onClick={() => toggleManualSelection('机构')} className="text-white hover:bg-white/10 h-7 text-xs px-2 font-normal">机构</Button>
              <Button variant="ghost" size="sm" onClick={() => toggleManualSelection('电话')} className="text-white hover:bg-white/10 h-7 text-xs px-2 font-normal">电话</Button>
              <Button variant="ghost" size="sm" onClick={() => toggleManualSelection('证件')} className="text-white hover:bg-white/10 h-7 text-xs px-2 font-normal">证件</Button>
              <Button variant="ghost" size="sm" onClick={() => toggleManualSelection('地址')} className="text-white hover:bg-white/10 h-7 text-xs px-2 font-normal">地址</Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

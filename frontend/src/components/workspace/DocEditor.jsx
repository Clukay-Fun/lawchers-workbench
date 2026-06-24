import { useEffect, useMemo, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';
import { getDocument, GlobalWorkerOptions, Util } from 'pdfjs-dist';
import { Button } from '@/components/ui/button';

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
  const candidates = terms.flatMap((term) => [
    { match: term.text, replacement: term.replacement },
    ...(term.replacement && term.replacement !== term.text
      ? [{ match: term.replacement, replacement: term.replacement }]
      : []),
  ]).sort((a, b) => b.match.length - a.match.length);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (const node of nodes) {
    if (!node.data.trim() || node.parentElement?.closest('.redaction-mark')) continue;
    let remaining = node.data;
    const fragment = document.createDocumentFragment();
    let changed = false;

    while (remaining) {
      let earliest = null;
      for (const candidate of candidates) {
        const index = remaining.indexOf(candidate.match);
        if (index >= 0 && (!earliest || index < earliest.index || (index === earliest.index && candidate.match.length > earliest.candidate.match.length))) {
          earliest = { index, candidate };
        }
      }
      if (!earliest) {
        fragment.append(document.createTextNode(remaining));
        break;
      }
      changed = true;
      if (earliest.index > 0) fragment.append(document.createTextNode(remaining.slice(0, earliest.index)));
      const mark = document.createElement('span');
      mark.className = 'redaction-mark';
      mark.textContent = earliest.candidate.replacement;
      fragment.append(mark);
      remaining = remaining.slice(earliest.index + earliest.candidate.match.length);
    }
    if (changed) node.replaceWith(fragment);
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
          const viewport = page.getViewport({ scale: 1.35 });
          const pageElement = document.createElement('section');
          pageElement.className = 'pdf-page';
          pageElement.style.width = `${viewport.width}px`;
          pageElement.style.height = `${viewport.height}px`;

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.setAttribute('aria-label', `PDF 第 ${pageNumber} 页`);
          pageElement.append(canvas);

          const textLayer = document.createElement('div');
          textLayer.className = 'pdf-text-layer';
          pageElement.append(textLayer);
          container.append(pageElement);

          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
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
  }, [url, mode, terms]);

  return error ? <div className="document-error">{error}</div> : <div className="pdf-canvas" ref={containerRef} />;
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
  const [moreOpen, setMoreOpen] = useState(false);
  const terms = useMemo(() => sensitiveTerms(material), [material]);

  const manualItems = material?.manualRedactions || [];

  const captureSelection = (event) => {
    if (mode !== 'original') return;
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
          <div className="more-wrap">
            <Button variant="ghost" size="icon" onClick={() => setMoreOpen(!moreOpen)} aria-label="更多操作" aria-expanded={moreOpen}>•••</Button>
            {moreOpen && (
              <div className="more-menu">
                <Button variant="ghost" className="w-full justify-start text-left text-sm hover:bg-secondary" onClick={() => { setMoreOpen(false); onReRedact(); }} disabled={redacting}>{redacting ? '正在重新识别…' : '重新识别敏感信息'}</Button>
                <div className="menu-separator" />
                <span className="px-2.5 py-1.5 block text-xs text-muted-foreground">人工标注 {manualItems.length} 处</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="document-viewport" ref={viewportRef} onMouseUp={captureSelection}>
        {isDocx && <DocxCanvas url={mode === 'redacted' && material.redactedFileUrl ? material.redactedFileUrl : material.filePath} mode={mode} terms={terms} />}
        {isPdf && <PdfCanvas url={material.filePath} mode={mode} terms={terms} />}
        {isText && <TextCanvas material={material} mode={mode} terms={terms} onTextChange={onTextChange} />}
        {isImage && <div className="image-document"><img src={mode === 'redacted' && material.redactedFileUrl ? material.redactedFileUrl : material.filePath} alt="案件材料预览" /></div>}
        {!isDocx && !isPdf && !isText && !isImage && <div className="document-error">暂不支持预览该文件格式。</div>}
      </div>

      {mode === 'original' && <div className="selection-hint">框选原文即可添加人工脱敏标注</div>}
      {selection && (
        <div className="selection-popover" style={{ left: selection.x, top: selection.y }}>
          <button onClick={toggleManualSelection}>
            {manualItems.some((item) => (typeof item === 'string' ? item : item.text) === selection.text) ? '取消标注' : '标记脱敏'}
          </button>
        </div>
      )}
    </section>
  );
}

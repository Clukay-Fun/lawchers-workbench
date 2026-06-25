import { useState, useRef } from 'react';
import { restoreFile } from '../api';
import { Button } from '@/components/ui/button';

export default function RestorePage() {
  const [redactedFile, setRedactedFile] = useState(null);
  const [mapFile, setMapFile] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [toast, setToast] = useState('');
  const redactedRef = useRef(null);
  const mapRef = useRef(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2400); };

  const handleRestore = async () => {
    if (!redactedFile || !mapFile) { showToast('请上传脱敏文件和 map.json'); return; }
    setRestoring(true);
    try {
      const response = await restoreFile(redactedFile, mapFile);
      const blob = await response.blob();
      const ext = redactedFile.name.substring(redactedFile.name.lastIndexOf('.'));
      const baseName = redactedFile.name.substring(0, redactedFile.name.lastIndexOf('.'));
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.restored${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast('还原成功');
      setRedactedFile(null);
      setMapFile(null);
      if (redactedRef.current) redactedRef.current.value = '';
      if (mapRef.current) mapRef.current.value = '';
    } catch (err) {
      showToast(err.message || '还原失败');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="tool-page">
      <div className="tool-card">
        <p className="tool-desc">上传脱敏文件和对应的 map.json，还原为原始内容。仅支持可逆格式（txt / md / csv / docx / xlsx）。</p>

        <div className="upload-zone">
          <label>
            <span>脱敏文件</span>
            <input ref={redactedRef} type="file" accept=".txt,.md,.csv,.docx,.xlsx" onChange={(e) => setRedactedFile(e.target.files?.[0])} />
          </label>
          {redactedFile && <span className="upload-name">{redactedFile.name}</span>}
        </div>

        <div className="upload-zone">
          <label>
            <span>map.json</span>
            <input ref={mapRef} type="file" accept=".json" onChange={(e) => setMapFile(e.target.files?.[0])} />
          </label>
          {mapFile && <span className="upload-name">{mapFile.name}</span>}
        </div>

        <div className="tool-note">
          <strong>注意：</strong>PDF 和扫描件不可还原。还原基于 map.json 中的 SHA-256 校验，文件不匹配时会失败。
        </div>

        <Button variant="default" onClick={handleRestore} disabled={restoring || !redactedFile || !mapFile}>
          {restoring ? '还原中…' : '开始还原'}
        </Button>
      </div>
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}

import { useRef, useState } from 'react';
import { deleteMaterial, redactFile, redactScanFile, uploadFile } from '../../api';
import { Button } from '@/components/ui/button';
import { FileText } from 'lucide-react';

export default function MaterialList({
  materials,
  activeIndex,
  onSelect,
  caseId,
  rulesConfig,
  onRefreshCase,
  onTriggerToast,
}) {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadLabel, setUploadLabel] = useState('');

  const handleFile = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      setUploadLabel('正在保存原件…');
      const uploaded = await uploadFile(file, caseId);
      setUploadLabel('正在识别敏感信息…');
      if (uploaded.displayMode === 'image') {
        await redactScanFile(uploaded.filePath, 'strict', rulesConfig, uploaded.materialId);
      } else {
        await redactFile(uploaded.filePath, 'strict', rulesConfig, uploaded.materialId);
      }
      await onRefreshCase();
      onTriggerToast('材料已保存，原件保持只读');
    } catch (error) {
      onTriggerToast(error.message || '材料处理失败');
    } finally {
      setUploading(false);
      setUploadLabel('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (material, index) => {
    if (!window.confirm(`确认删除材料「${material.name}」？本地原件、脱敏副本和映射将一并清理。`)) return;
    await deleteMaterial(material.id);
    await onRefreshCase();
    if (index === activeIndex) onSelect(Math.max(0, index - 1));
  };

  return (
    <aside className="material-panel">
      <div className="material-panel-head">
        <h2>材料</h2>
        <span>{materials.length}</span>
      </div>

      <div className="material-list">
        {materials.map((material, index) => (
          <div key={material.id} className={`material-row ${index === activeIndex ? 'active' : ''}`}>
            <button className="material-select" onClick={() => onSelect(index)}>
              <FileText className="w-[18px] h-[18px] shrink-0 text-muted-foreground" />
              <span><strong>{material.name}</strong><small>{material.entitiesCount || 0} 处标注 · {material.status === 'done' ? '已导出复检' : '待校对'}</small></span>
            </button>
            <Button variant="ghost" size="icon" className="material-delete" aria-label={`删除 ${material.name}`} onClick={() => handleDelete(material, index)}>×</Button>
          </div>
        ))}
      </div>

      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept=".txt,.md,.pdf,.docx,.png,.jpg,.jpeg,.tiff,.bmp"
        onChange={(event) => handleFile(event.target.files?.[0])}
      />
      <Button variant="outline" className="add-material" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
        <span aria-hidden="true">＋</span>
        {uploading ? uploadLabel : '添加材料'}
      </Button>
    </aside>
  );
}

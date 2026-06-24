import { useMemo, useState } from 'react';
import MaterialList from './workspace/MaterialList';
import DocEditor from './workspace/DocEditor';
import {
  exportRedactedFile,
  redactFile,
  redactScanFile,
  saveMaterialText,
  saveManualRedactions,
} from '../api';

export default function Workspace({ currentCase, onUpdateCase, settings, caseId, onRefreshCase }) {
  const [toast, setToast] = useState('');
  const [exporting, setExporting] = useState(false);
  const [redacting, setRedacting] = useState(false);

  const activeIndex = currentCase.selectedMaterialIndex || 0;
  const currentMaterial = useMemo(
    () => currentCase.materials?.[activeIndex] || null,
    [currentCase.materials, activeIndex],
  );

  const triggerToast = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2400);
  };

  const selectMaterial = (index) => {
    onUpdateCase({ ...currentCase, selectedMaterialIndex: index });
  };

  const updateMaterial = (materialId, changes) => {
    onUpdateCase({
      ...currentCase,
      materials: currentCase.materials.map((material) => material.id === materialId ? { ...material, ...changes } : material),
    });
  };

  const handleManualRedactions = async (items) => {
    if (!currentMaterial) return;
    const result = await saveManualRedactions(currentMaterial.id, items);
    updateMaterial(currentMaterial.id, { manualRedactions: result.items, status: 'todo' });
    if (currentMaterial.displayMode !== 'image') {
      await redactFile(
        currentMaterial.filePath,
        'strict',
        settings.rulesConfig,
        currentMaterial.id,
        result.items,
      );
      await onRefreshCase();
    }
    triggerToast('人工标注已保存到本地映射');
  };

  const handleTextChange = async (text) => {
    if (!currentMaterial) return;
    await saveMaterialText(currentMaterial.id, text);
    updateMaterial(currentMaterial.id, { workingText: text, status: 'todo' });
    triggerToast('工作副本已保存；原件未修改');
  };

  const handleReRedact = async () => {
    if (!currentMaterial) return;
    setRedacting(true);
    try {
      if (currentMaterial.displayMode === 'image') {
        await redactScanFile(currentMaterial.filePath, 'strict', settings.rulesConfig, currentMaterial.id);
      } else {
        await redactFile(
          currentMaterial.filePath,
          'strict',
          settings.rulesConfig,
          currentMaterial.id,
          currentMaterial.manualRedactions,
        );
      }
      await onRefreshCase();
      triggerToast('已从只读原件重新识别');
    } catch (error) {
      triggerToast(error.message || '重新识别失败');
    } finally {
      setRedacting(false);
    }
  };

  const handleExport = async () => {
    if (!currentMaterial) return;
    setExporting(true);
    try {
      await exportRedactedFile(currentMaterial.id, currentMaterial.name);
      await onRefreshCase();
      triggerToast('复检通过，已导出原格式脱敏副本');
    } catch (error) {
      triggerToast(error.message || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="workspace-grid">
      <MaterialList
        materials={currentCase.materials || []}
        activeIndex={activeIndex}
        onSelect={selectMaterial}
        caseId={caseId}
        rulesConfig={settings.rulesConfig}
        onRefreshCase={onRefreshCase}
        onTriggerToast={triggerToast}
      />
      <DocEditor
        key={`${currentMaterial?.id || 'empty'}-${settings.defaultView}`}
        material={currentMaterial}
        defaultView={settings.defaultView}
        onManualRedactionsChange={handleManualRedactions}
        onTextChange={handleTextChange}
        onReRedact={handleReRedact}
        onExport={handleExport}
        onRequestUpload={() => document.querySelector('.add-material')?.click()}
        redacting={redacting}
        exporting={exporting}
      />
      <div className={`toast ${toast ? 'show' : ''}`} role="status">{toast}</div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import MaterialList from './workspace/MaterialList';
import ReviewPanel from './workspace/ReviewPanel';

export default function Workspace({ currentCase, onUpdateCase, settings, caseId, onRefreshCase }) {
  const [toast, setToast] = useState('');

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

  return (
    <div className="workspace-grid">
      <MaterialList
        materials={currentCase.materials || []}
        activeIndex={activeIndex}
        onSelect={selectMaterial}
        caseId={caseId}
        onRefreshCase={onRefreshCase}
        onTriggerToast={triggerToast}
        rulesConfig={settings?.rulesConfig}
      />
      {currentMaterial ? (
        <ReviewPanel
          materialId={currentMaterial.id}
          materialName={currentMaterial.name}
        />
      ) : (
        <section className="document-workspace empty-document">
          <div><strong>添加一份案件材料</strong><p>支持 DOCX、文本 PDF 与扫描 PDF。</p></div>
        </section>
      )}
      <div className={`toast ${toast ? 'show' : ''}`} role="status">{toast}</div>
    </div>
  );
}

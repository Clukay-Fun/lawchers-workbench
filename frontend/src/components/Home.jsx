import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

function formatUpdatedAt(value) {
  if (!value) return '最近更新';
  const date = new Date(value.replace?.(' ', 'T') || value);
  if (Number.isNaN(date.getTime())) return '最近更新';
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export default function Home({ cases, onSelectCase, onCreateCase, onDeleteCase }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [newCaseData, setNewCaseData] = useState({
    reason: '劳动争议', employeeName: '', companyName: '',
  });

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!newCaseData.employeeName.trim() || !newCaseData.companyName.trim()) return;
    setSubmitting(true);
    try {
      await onCreateCase(newCaseData);
      setIsModalOpen(false);
      setNewCaseData({ reason: '劳动争议', employeeName: '', companyName: '' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (item) => {
    setOpenMenuId(null);
    if (!window.confirm(`确认删除案件「${item.employeeName} 诉 ${item.companyName}」？关联材料与本地脱敏产物将一并清理。`)) return;
    await onDeleteCase(item.id);
  };

  return (
    <div className="home-container">
      <div className="case-register-head">
        <p>{cases.length ? `${cases.length} 个本地案件` : '案件材料仅保存在本机'}</p>
        <Button variant="default" onClick={() => setIsModalOpen(true)}>新建案件</Button>
      </div>

      <div className="case-register" role="table" aria-label="案件列表">
        <div className="case-register-labels" role="row">
          <span>案件</span><span>材料与更新时间</span><span>状态</span><span></span>
        </div>
        {cases.length === 0 ? (
          <div className="empty-register">
            <strong>还没有案件</strong>
            <p>新建案件后，即可上传材料并在原格式文档中校对脱敏结果。</p>
            <Button variant="default" onClick={() => setIsModalOpen(true)}>新建第一个案件</Button>
          </div>
        ) : cases.map((item) => {
          const materialText = `${item.materialCount || 0} 份材料 · ${formatUpdatedAt(item.updatedAt)} 更新`;
          return (
            <Card variant="interactive" className="case-register-row" role="row" key={item.id} onClick={() => onSelectCase(item)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') onSelectCase(item); }}>
              <div className="case-register-title">
                <strong>{item.employeeName} 诉 {item.companyName}</strong>
                <span>{item.caseNo} · {item.reason}</span>
              </div>
              <span className="case-register-meta">{materialText}</span>
              <Badge variant={item.status === 'done' ? 'success' : 'warning'}>{item.status === 'done' ? '已完成' : '待校对'}</Badge>
              <div className="row-menu-wrap">
                <Button
                  variant="ghost"
                  size="icon"
                  className="row-menu-button"
                  aria-label="案件操作"
                  aria-expanded={openMenuId === item.id}
                  onClick={(event) => { event.stopPropagation(); setOpenMenuId(openMenuId === item.id ? null : item.id); }}
                >•••</Button>
                {openMenuId === item.id && (
                  <div className="row-menu" onClick={(event) => event.stopPropagation()}>
                    <Button variant="ghost" className="w-full justify-start text-destructive hover:bg-secondary" onClick={() => handleDelete(item)}>删除案件</Button>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {isModalOpen && (
        <div className="modal-backdrop open" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsModalOpen(false); }}>
          <div className="modal compact-modal" role="dialog" aria-modal="true" aria-labelledby="new-case-title">
            <div className="modal-head">
              <h2 id="new-case-title">新建案件</h2>
              <Button variant="ghost" size="icon" onClick={() => setIsModalOpen(false)} aria-label="关闭">×</Button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <label className="form-group"><span>案由</span><select value={newCaseData.reason} onChange={(event) => setNewCaseData({ ...newCaseData, reason: event.target.value })}><option>劳动争议</option></select></label>
                <label className="form-group"><span>当事人</span><input autoFocus value={newCaseData.employeeName} onChange={(event) => setNewCaseData({ ...newCaseData, employeeName: event.target.value })} placeholder="劳动者姓名" required /></label>
                <label className="form-group"><span>相对方</span><input value={newCaseData.companyName} onChange={(event) => setNewCaseData({ ...newCaseData, companyName: event.target.value })} placeholder="用人单位名称" required /></label>
              </div>
              <div className="modal-foot">
                <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>取消</Button>
                <Button type="submit" variant="default" disabled={submitting}>{submitting ? '正在创建…' : '创建案件'}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

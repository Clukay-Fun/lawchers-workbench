import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { FilePlus2 } from 'lucide-react';

function formatUpdatedAt(value) {
  if (!value) return '最近更新';
  const date = new Date(value.replace?.(' ', 'T') || value);
  if (Number.isNaN(date.getTime())) return '最近更新';
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export default function Home({ cases, onSelectCase, onCreateCase, onDeleteCase }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [, setOpenMenuId] = useState(null);
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
        <Button variant="default" onClick={() => setIsModalOpen(true)}>新建案件</Button>
      </div>

      <div className="case-register" role="table" aria-label="案件列表">
        <div className="case-register-labels" role="row">
          <span>案件</span><span>材料与更新时间</span><span>状态</span><span></span>
        </div>
        {cases.length === 0 ? (
          <div className="empty-register">
            <span className="empty-icon"><FilePlus2 /></span>
            <strong>暂无案件</strong>
            <p>新建案件并上传材料，在原格式文档上脱敏校对。</p>
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
              <div className="row-menu-wrap">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="row-menu-button"
                      aria-label="案件操作"
                      onClick={(event) => event.stopPropagation()}
                    >•••</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent onClick={(event) => event.stopPropagation()} align="end">
                    <DropdownMenuItem className="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer" onSelect={(event) => { event.preventDefault(); handleDelete(item); }}>
                      删除案件
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </Card>
          );
        })}
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="compact-modal">
          <DialogHeader>
            <DialogTitle id="new-case-title">新建案件</DialogTitle>
            <DialogClose asChild>
              <Button variant="ghost" size="icon" aria-label="关闭">×</Button>
            </DialogClose>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="modal-body p-0 py-4">
              <label className="form-group"><span>案由</span><select value={newCaseData.reason} onChange={(event) => setNewCaseData({ ...newCaseData, reason: event.target.value })}><option>劳动争议</option></select></label>
              <label className="form-group"><span>当事人</span><input autoFocus value={newCaseData.employeeName} onChange={(event) => setNewCaseData({ ...newCaseData, employeeName: event.target.value })} placeholder="劳动者姓名" required /></label>
              <label className="form-group"><span>相对方</span><input value={newCaseData.companyName} onChange={(event) => setNewCaseData({ ...newCaseData, companyName: event.target.value })} placeholder="用人单位名称" required /></label>
            </div>
            <DialogFooter className="p-0 pt-4">
              <DialogClose asChild>
                <Button type="button" variant="ghost">取消</Button>
              </DialogClose>
              <Button type="submit" variant="default" disabled={submitting}>{submitting ? '正在创建…' : '创建案件'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

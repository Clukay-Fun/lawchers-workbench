import { useState, useEffect } from 'react';
import { getHistory, deleteHistory } from '../api';
import { Button } from '@/components/ui/button';

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value.replace?.(' ', 'T') || value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function HistoryPage() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2000); };

  const load = async () => {
    try {
      setTasks(await getHistory() || []);
    } catch (err) {
      showToast(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id) => {
    if (!window.confirm('确认删除此条记录？')) return;
    try {
      await deleteHistory(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      showToast(err.message || '删除失败');
    }
  };

  if (loading) return <div className="tool-loading">加载中…</div>;

  return (
    <div className="tool-page">
      <div className="tool-card">
        <h2>任务历史</h2>
        {tasks.length === 0 ? (
          <div className="tool-empty-inline">暂无历史记录。完成脱敏导出后，任务会自动记录在此。</div>
        ) : (
          <div className="history-table">
            <div className="history-header">
              <span>文件名</span><span>格式</span><span>实体统计</span><span>残留</span><span>时间</span><span></span>
            </div>
            {tasks.map((t) => {
              const stats = (() => { try { return JSON.parse(t.entity_stats || '{}'); } catch { return {}; } })();
              const statStr = Object.entries(stats).map(([k, v]) => `${k}×${v}`).join(' ') || '—';
              return (
                <div key={t.id} className="history-row">
                  <span className="history-filename">{t.filename}</span>
                  <span>{(t.ext || '').toUpperCase().replace('.', '')}</span>
                  <span className="history-stats">{statStr}</span>
                  <span className={t.residual_passed ? 'history-pass' : 'history-fail'}>
                    {t.residual_passed ? '✓' : '✗'}
                  </span>
                  <span className="history-date">{formatDate(t.created_at)}</span>
                  <Button variant="ghost" size="icon" aria-label="删除" onClick={() => handleDelete(t.id)}>×</Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}

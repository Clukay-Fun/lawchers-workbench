import { useEffect, useState } from 'react';
import { deleteHistory, downloadHistoryFile, getHistory } from '../api';
import { Button } from '@/components/ui/button';

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value.replace?.(' ', 'T') || value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function parseStats(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function redactedFilename(filename = 'document') {
  return filename.replace(/(\.[^.]+)?$/, '.redacted$1');
}

export default function DownloadPage() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState(null);
  const [toast, setToast] = useState('');

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2200);
  };

  const load = async () => {
    try {
      const rows = await getHistory();
      setTasks((rows || []).filter((task) => task.export_path));
    } catch (err) {
      showToast(err.message || '加载下载列表失败');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  const handleDownload = async (task) => {
    setDownloadingId(task.id);
    try {
      const response = await downloadHistoryFile(task.id);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = redactedFilename(task.filename);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err.message || '下载失败');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('确认删除这条下载记录及关联文件？')) return;
    try {
      await deleteHistory(id);
      setTasks((prev) => prev.filter((task) => task.id !== id));
    } catch (err) {
      showToast(err.message || '删除失败');
    }
  };

  if (loading) return <div className="tool-loading">加载中…</div>;

  return (
    <div className="tool-page">
      <div className="tool-card">

        {tasks.length === 0 ? (
          <div className="tool-empty-inline">暂无可下载文件。完成脱敏导出后，会出现在这里。</div>
        ) : (
          <div className="download-table">
            <div className="download-header">
              <span>脱敏文件</span><span>格式</span><span>脱敏统计</span><span>复检</span><span>导出时间</span><span></span>
            </div>
            {tasks.map((task) => {
              const stats = parseStats(task.entity_stats);
              const statStr = Object.entries(stats).map(([key, count]) => `${key}×${count}`).join(' ') || '—';
              const canDownload = task.residual_passed && task.export_path;
              return (
                <div key={task.id} className="download-row">
                  <span className="history-filename">{redactedFilename(task.filename)}</span>
                  <span>{(task.ext || '').replace('.', '').toUpperCase() || '—'}</span>
                  <span className="history-stats">{statStr}</span>
                  <span className={task.residual_passed ? 'history-pass' : 'history-fail'}>
                    {task.residual_passed ? '通过' : '阻断'}
                  </span>
                  <span className="history-date">{formatDate(task.created_at)}</span>
                  <span className="download-actions">
                    <Button
                      size="sm"
                      disabled={!canDownload || downloadingId === task.id}
                      onClick={() => handleDownload(task)}
                    >
                      {downloadingId === task.id ? '下载中' : '下载'}
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="删除" onClick={() => handleDelete(task.id)}>×</Button>
                  </span>
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

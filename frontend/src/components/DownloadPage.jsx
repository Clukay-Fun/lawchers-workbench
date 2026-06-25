import { useState, useEffect } from 'react';
import { getDiagnostics } from '../api';

export default function DownloadPage() {
  const [diagnostics, setDiagnostics] = useState(null);

  useEffect(() => {
    getDiagnostics().then(setDiagnostics).catch(() => {});
  }, []);

  return (
    <div className="settings-view">
      <section className="settings-section">
        <h2>本机安装状态</h2>
        <div className="engine-status-grid">
          <div className="engine-status-row">
            <span className="engine-status-label">引擎路径</span>
            <span className="engine-status-value">{diagnostics?.binPath || 'unknown'}</span>
          </div>
          <div className="engine-status-row">
            <span className="engine-status-label">引擎版本</span>
            <span className="engine-status-value">{diagnostics?.installedVersion || 'unknown'}</span>
          </div>
          <div className="engine-status-row">
            <span className="engine-status-label">NER 模型</span>
            <span className="engine-status-value">{diagnostics?.nerEnabled === true ? '已安装' : '未安装'}</span>
          </div>
          <div className="engine-status-row">
            <span className="engine-status-label">模型路径</span>
            <span className="engine-status-value">{diagnostics?.modelDir || 'unknown'}</span>
          </div>
          <div className="engine-status-row">
            <span className="engine-status-label">requirements pin</span>
            <span className="engine-status-value">{diagnostics?.pinnedCommit || 'unknown'}</span>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2>macOS 安装说明</h2>
        <div className="install-steps">
          <ol>
            <li>双击「安装 LAWCHERS.command」或在终端运行 <code>npm run setup</code></li>
            <li>首次安装会自动下载引擎和 NER 模型，需要几分钟</li>
            <li>安装完成后双击「启动 LAWCHERS.command」或运行 <code>npm run dev</code></li>
          </ol>
          <p className="tool-note">
            若 Gatekeeper 拦截，请在「系统设置 → 隐私与安全性」中允许运行。
          </p>
        </div>
      </section>

      <section className="settings-section">
        <h2>Windows（best-effort）</h2>
        <p className="tool-note">
          Windows 支持为 best-effort，未经完整测试。运行 <code>安装 LAWCHERS.bat</code>。
        </p>
      </section>

      <section className="settings-section">
        <h2>清理缓存</h2>
        <p className="tool-note">
          上传的原件和脱敏产物保存在 <code>uploads/</code> 目录，历史记录保存在 SQLite 数据库。
          手动删除这些文件即可清理缓存。
        </p>
      </section>
    </div>
  );
}

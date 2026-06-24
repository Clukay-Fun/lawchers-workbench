import { Folder, Settings } from 'lucide-react';

export default function Sidebar({ currentView, onViewChange }) {
  const goHome = () => onViewChange('home');
  return (
    <aside className="sidebar">
      <button className="brand-mark" onClick={goHome} aria-label="返回案件列表">L</button>
      <nav className="nav-menu" aria-label="主导航">
        <button className={`nav-item ${currentView === 'home' || currentView === 'workspace' ? 'active' : ''}`} onClick={goHome}>
          <Folder className="w-5 h-5" /><span>案件</span>
        </button>
        <button className={`nav-item ${currentView === 'settings' ? 'active' : ''}`} onClick={() => onViewChange('settings')}>
          <Settings className="w-5 h-5" /><span>设置</span>
        </button>
      </nav>
      <div className="local-only" title="数据仅保存在本机"><span></span>本地</div>
    </aside>
  );
}

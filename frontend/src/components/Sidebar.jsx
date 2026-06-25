import { Shield, RotateCcw, History, BookOpen, Settings, Download } from 'lucide-react';

const NAV_ITEMS = [
  { key: 'desensitize', label: '脱敏', Icon: Shield },
  { key: 'restore', label: '还原', Icon: RotateCcw },
  { key: 'history', label: '历史', Icon: History },
  { key: 'rules', label: '规则', Icon: BookOpen },
  { key: 'settings', label: '设置', Icon: Settings },
  { key: 'download', label: '下载', Icon: Download },
];

export default function Sidebar({ currentView, onViewChange }) {
  return (
    <aside className="sidebar">
      <button className="brand-mark" onClick={() => onViewChange('desensitize')} aria-label="LAWCHERS">L</button>
      <nav className="nav-menu" aria-label="主导航">
        {NAV_ITEMS.map(({ key, label, Icon }) => (
          <button
            key={key}
            className={`nav-item ${currentView === key ? 'active' : ''}`}
            onClick={() => onViewChange(key)}
          >
            <Icon className="w-5 h-5" /><span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="local-only" title="数据仅保存在本机"><span></span>本地</div>
    </aside>
  );
}

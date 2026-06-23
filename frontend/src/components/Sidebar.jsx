
/**
 * 描述: 左侧常驻导航栏组件
 * 主要功能:
 *     - 展示 LAWCHERS 天平狮子头品牌矢量 Logo
 *     - 提供工作台视图切换（首页、办案区、设置中心）
 *     - 呈现当前承办律师头像标识
 */

// #region 侧边栏导航组件

/**
 * 侧边栏组件
 * @param {Object} props 组件属性
 * @param {string} props.currentView 当前激活的视图名称
 * @param {Function} props.onViewChange 切换视图的回调函数
 * @param {Object} props.sysSettings 系统与律师落款配置
 * 
 * 功能:
 *     - 绘制导航菜单并依据 currentView 动态高亮，触发 onViewChange 切换主内容区
 */
export default function Sidebar({ currentView, onViewChange, sysSettings }) {
  // 获取律师姓名的缩写作为头像字符 (如：Sarah J. -> SJ)
  const getAvatarText = () => {
    const name = sysSettings.lawyerName || 'Sarah J.';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <aside className="sidebar">
      {/* 品牌 Logo 区域 */}
      <div className="brand-logo">
        <div className="logo-badge">
          <svg
            viewBox="0 0 100 100"
            width="30"
            height="30"
            style={{
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 3,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
            }}
          >
            <polygon points="50,5 90,28 90,72 50,95 10,72 10,28" />
            <line x1="50" y1="20" x2="50" y2="75" />
            <path d="M 22 35 L 50 20 L 78 35" />
            <path d="M 25 35 L 35 55 L 50 60 L 65 55 L 75 35" />
            <circle cx="28" cy="42" r="5" />
            <circle cx="72" cy="42" r="5" />
            <path d="M 40 68 L 50 75 L 60 68" />
            <path d="M 45 60 L 50 65 L 55 60" />
          </svg>
        </div>
        <span>LAWCHERS</span>
      </div>

      {/* 导航菜单列表 */}
      <nav className="nav-menu">
        <div
          className={`nav-item ${currentView === 'home' ? 'active' : ''}`}
          onClick={() => onViewChange('home')}
        >
          <svg viewBox="0 0 24 24">
            <path d="M3 10.5 12 3l9 7.5" />
            <path d="M5 9.5V20h14V9.5" />
            <path d="M9 20v-6h6v6" />
          </svg>
          <span>首页</span>
        </div>

        <div
          className={`nav-item ${currentView === 'workspace' ? 'active' : ''}`}
          onClick={() => onViewChange('workspace')}
        >
          <svg viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 9h18M9 9v11" />
          </svg>
          <span>办案区</span>
        </div>

        <div className="nav-divider"></div>

        <div
          className={`nav-item ${currentView === 'settings' ? 'active' : ''}`}
          onClick={() => onViewChange('settings')}
        >
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span>设置</span>
        </div>
      </nav>

      {/* 承办人头像 */}
      <div className="user-profile" title={`${sysSettings.lawfirm || '敬法律师事务所'} | ${sysSettings.lawyerName || 'Sarah J.'}`}>
        {getAvatarText()}
      </div>
    </aside>
  );
}

// #endregion

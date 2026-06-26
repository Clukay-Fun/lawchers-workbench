import { useState } from 'react';
import Sidebar from './components/Sidebar';
import DesensitizePage from './components/DesensitizePage';
import VisualMaskPage from './components/VisualMaskPage';
import RestorePage from './components/RestorePage';
import HistoryPage from './components/HistoryPage';
import RulesPage from './components/RulesPage';
import SettingsPage from './components/SettingsPage';
import DownloadPage from './components/DownloadPage';

const availableRules = [
  { key: 'PERSON', label: '姓名' },
  { key: 'PHONE', label: '手机号' },
  { key: 'LANDLINE', label: '固定电话' },
  { key: 'ID_CARD', label: '身份证号' },
  { key: 'PASSPORT', label: '护照' },
  { key: 'EMAIL', label: '电子邮箱' },
  { key: 'CASE_NO', label: '案号 / 合同编号' },
  { key: 'ORG_CODE', label: '统一社会信用代码' },
  { key: 'BANK_CARD', label: '银行卡号' },
  { key: 'BANK_BRANCH', label: '银行网点' },
  { key: 'MONEY', label: '金额' },
  { key: 'API_TOKEN', label: 'API Token / 密钥' },
  { key: 'ORG', label: '机构' },
  { key: 'LOC', label: '地点 / 地址' },
  { key: 'DATE', label: '日期' },
];

const defaultRules = Object.fromEntries(availableRules.map((rule) => [rule.key, true]));
defaultRules.DATE = false;

const VIEW_TITLES = {
  desensitize: '脱敏',
  restore: '还原脱敏文件',
  history: '任务历史',
  rules: '脱敏规则',
  settings: '设置',
  download: '下载中心',
};

export default function App() {
  const [currentView, setCurrentView] = useState('desensitize');
  const [resumeTaskId, setResumeTaskId] = useState(null);
  const [settings, setSettings] = useState({
    maskChar: '*',
    defaultView: 'redacted',
    preserveFormat: true,
    verifyBeforeExport: true,
    rulesConfig: defaultRules,
  });

  const handleResumeDone = () => setResumeTaskId(null);

  const handleResumeTask = (taskId) => {
    setResumeTaskId(taskId);
    setCurrentView('desensitize');
  };

  const renderPage = () => {
    switch (currentView) {
      case 'desensitize':
        return <VisualMaskPage settings={settings} resumeTaskId={resumeTaskId} onResumeDone={handleResumeDone} />;
      case 'restore':
        return <RestorePage />;
      case 'history':
        return <HistoryPage onResumeTask={handleResumeTask} />;
      case 'rules':
        return <RulesPage settings={settings} onSettingsChange={setSettings} />;
      case 'settings':
        return <SettingsPage settings={settings} onSettingsChange={setSettings} />;
      case 'download':
        return <DownloadPage />;
      default:
        return <DesensitizePage settings={settings} />;
    }
  };

  return (
    <div className="app-shell">
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />
      <main className="main-container">
        {currentView !== 'desensitize' && (
          <header className="top-header">
            <h1>{VIEW_TITLES[currentView] || ''}</h1>
          </header>
        )}
        <div className="page-wrapper">
          {renderPage()}
        </div>
      </main>
    </div>
  );
}

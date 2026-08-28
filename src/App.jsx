import React, { useState } from 'react';
import { useAuth } from './context/AuthContext';
import { useWeather } from './context/WeatherContext';
import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { LoginScreen } from './components/auth/LoginScreen';

// Views
import { CommandCenter } from './components/views/CommandCenter';
import { FleetMap } from './components/views/FleetMap';
import { Incidents } from './components/views/Incidents';
import { StationCredentials } from './components/views/StationCredentials';
import { QCRules } from './components/views/QCRules';
import { FaultLab } from './components/views/FaultLab';
import { ModelGovernance } from './components/views/ModelGovernance';
import { Export } from './components/views/Export';
import { StationHUD } from './components/views/StationHUD';
import { StationUpload } from './components/views/StationUpload';
import { StationDiagnostics } from './components/views/StationDiagnostics';
import { StationChecklist } from './components/views/StationChecklist';
import { EdgeSync } from './components/views/EdgeSync';

export const App = () => {
  const { isAuthenticated } = useAuth();
  const { currentView } = useWeather();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  const renderCurrentView = () => {
    switch (currentView) {
      case 'command-center':
        return <CommandCenter />;
      case 'fleet-map':
        return <FleetMap />;
      case 'incidents':
        return <Incidents />;
      case 'credentials':
        return <StationCredentials />;
      case 'qc-rules':
        return <QCRules />;
      case 'fault-lab':
        return <FaultLab />;
      case 'model-governance':
        return <ModelGovernance />;
      case 'export':
        return <Export />;
      case 'station-hud':
        return <StationHUD />;
      case 'station-upload':
        return <StationUpload />;
      case 'station-diagnostics':
        return <StationDiagnostics />;
      case 'station-checklist':
        return <StationChecklist />;
      case 'edge-sync':
        return <EdgeSync />;
      default:
        return <CommandCenter />;
    }
  };

  return (
    <div className="app-container">
      <Sidebar collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} />
      <main className="cyber-main">
        <Topbar />
        <section className="cyber-content" id="main-content-area">
          {renderCurrentView()}
        </section>
      </main>
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import './App.css';
import KYCForm from './components/KYC/KYCForm';
import EKYCWorkflow from './components/KYC/EKYCWorkflow';
import AdminWorkflowConfig from './components/Admin/AdminWorkflowConfig';
import WorkflowResolver from './components/KYC/WorkflowResolver';

type AppState = 'login' | 'workflow' | 'complete';
type RouteType = 'home' | 'admin' | 'kyc-link';

interface UserData {
  userId: string;
  email?: string;
  mobileNumber: string;
}

function App() {
  const [appState, setAppState] = useState<AppState>('login');
  const [userData, setUserData] = useState<UserData | null>(null);
  const [completedSessionId, setCompletedSessionId] = useState<string>('');
  const [currentRoute, setCurrentRoute] = useState<RouteType>('home');
  const [configId, setConfigId] = useState<string>('');

  // Simple routing based on URL path
  useEffect(() => {
    const detectRoute = () => {
      const path = window.location.pathname;
      
      if (path.startsWith('/kyc/')) {
        // Extract config ID from path like /kyc/:configId
        const parts = path.split('/');
        const id = parts[2];
        if (id) {
          setConfigId(id);
          setCurrentRoute('kyc-link');
        } else {
          setCurrentRoute('admin');
        }
      } else if (path === '/user') {
        // Special route for user KYC without config
        setCurrentRoute('home');
      } else {
        // Default route is admin
        setCurrentRoute('admin');
      }
    };

    detectRoute();

    // Listen for popstate events (back/forward navigation)
    window.addEventListener('popstate', detectRoute);
    
    return () => {
      window.removeEventListener('popstate', detectRoute);
    };
  }, []);

  const handleStartKYC = (formData: { mobileNumber: string; otp: string }) => {
    // Create user data from form
    const user: UserData = {
      userId: `user-${Date.now()}`,
      email: `${formData.mobileNumber}@example.com`,
      mobileNumber: formData.mobileNumber,
    };
    
    setUserData(user);
    setAppState('workflow');
  };

  const handleWorkflowComplete = (sessionId: string) => {
    setCompletedSessionId(sessionId);
    setAppState('complete');
  };

  const handleStartNew = () => {
    setUserData(null);
    setCompletedSessionId('');
    setAppState('login');
  };

  // Admin route (default)
  if (currentRoute === 'admin') {
    return (
      <div className="App">
        <AdminWorkflowConfig />
      </div>
    );
  }

  // KYC link route (with workflow config)
  if (currentRoute === 'kyc-link' && configId) {
    return (
      <div className="App">
        <WorkflowResolver configId={configId} />
      </div>
    );
  }

  // User KYC route (without workflow config)
  return (
    <div className="App">
      {appState === 'login' && (
        <KYCForm onStartKYC={handleStartKYC} />
      )}
      
      {appState === 'workflow' && userData && (
        <EKYCWorkflow
          userId={userData.userId}
          email={userData.email}
          mobileNumber={userData.mobileNumber}
          onComplete={handleWorkflowComplete}
          onCancel={handleStartNew}
        />
      )}
      
      {appState === 'complete' && (
        <div className="completion-page">
          <div className="completion-container">
            <div className="success-icon-large">✓</div>
            <h1>KYC Verification Complete!</h1>
            <p>Your identity has been successfully verified.</p>
            <p className="session-id">Session ID: {completedSessionId}</p>
            <button className="btn-primary" onClick={handleStartNew}>
              Start New Verification
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;


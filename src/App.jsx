import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Messages from './Components/Messages.jsx';
import Auth from './Components/Auth.jsx';
import ProtectedRoute from './Components/ProtectedRoute.js';
import { AuthProvider } from './contexts/AuthContext.js';

// Main App component with routing
function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/" element={
            <ProtectedRoute>
              <Messages />
            </ProtectedRoute>
          } />
          <Route path="/auth" element={<Auth />} />
          <Route path="/login" element={<Auth />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;

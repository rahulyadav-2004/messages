import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChange, createUserProfile, updateUserOnlineStatus } from '../firebase/config';

// Create AuthContext
const AuthContext = createContext();

// Custom hook to use auth context
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// AuthProvider component
export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChange(async (user) => {
      if (user) {
        // Ensure user profile exists in Firestore
        await createUserProfile(user);
        // Update online status
        await updateUserOnlineStatus(user.uid, true);
      } else if (currentUser) {
        // Update offline status when user logs out
        await updateUserOnlineStatus(currentUser.uid, false);
      }
      
      setCurrentUser(user);
      setLoading(false);
    });

    return unsubscribe; // Cleanup subscription on unmount
  }, [currentUser]);

  const value = {
    currentUser,
    loading
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

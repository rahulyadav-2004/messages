import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { 
  logOut, 
  listenToUsers, 
  sendMessage, 
  getChatMessages, 
  createChatId, 
  initializePresence, 
  listenToUserPresence,
  getUserChatsWithCounts,
  markChatAsRead,
  uploadFile,
  sendMediaMessage,
  getMessageType,
  formatFileSize
} from '../firebase/config';

function Messages() {
  const [avatarsCollapsed, setAvatarsCollapsed] = useState(false);
  const [selectedChat, setSelectedChat] = useState(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [userPresence, setUserPresence] = useState({});
  const [chatCounts, setChatCounts] = useState({});
  const [isActivelyChatting, setIsActivelyChatting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [showMediaPreview, setShowMediaPreview] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState(null);
  const { currentUser } = useAuth();
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
   // Memoized user list with unread counts and sorted by activity
  const filteredUsers = useMemo(() => {
    const otherUsers = users.filter(user => user.id !== currentUser?.uid).map(user => {
      const chatId = createChatId(currentUser?.uid || '', user.id);
      const unreadCount = chatCounts[chatId]?.unreadCount || 0;
      const lastMessageTime = chatCounts[chatId]?.lastMessageTimestamp;
      
      return {
        ...user,
        isOnline: userPresence[user.id] || false,
        unreadCount,
        lastMessageTime,
        lastMessage: chatCounts[chatId]?.lastMessage || null
      };
    });
    
    // Sort users: Keep selected chat stable during active conversation
    return otherUsers.sort((a, b) => {
      // If we're actively chatting, keep the selected chat at the top to prevent jumping
      const isASelected = a.id === selectedChat;
      const isBSelected = b.id === selectedChat;
      
      if (isActivelyChatting) {
        // During active chatting, strongly prioritize the selected chat
        if (isASelected && !isBSelected) return -1;
        if (isBSelected && !isASelected) return 1;
      } else {
        // Normal behavior: only slightly prioritize selected chat
        if (isASelected && !isBSelected && a.lastMessageTime) return -1;
        if (isBSelected && !isASelected && b.lastMessageTime) return 1;
      }
      
      // First priority: unread messages (only for non-selected chats)
      if (!isASelected && !isBSelected) {
        if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
        if (a.unreadCount === 0 && b.unreadCount > 0) return 1;
      }
      
      // Second priority: recent messages
      if (a.lastMessageTime && b.lastMessageTime) {
        const aTime = a.lastMessageTime.toDate ? a.lastMessageTime.toDate() : new Date(a.lastMessageTime);
        const bTime = b.lastMessageTime.toDate ? b.lastMessageTime.toDate() : new Date(b.lastMessageTime);
        if (aTime > bTime) return -1;
        if (aTime < bTime) return 1;
      }
      if (a.lastMessageTime && !b.lastMessageTime) return -1;
      if (!a.lastMessageTime && b.lastMessageTime) return 1;
      
      // Third priority: online status
      if (a.isOnline && !b.isOnline) return -1;
      if (!a.isOnline && b.isOnline) return 1;
      
      // Fourth priority: creation time
      const aCreated = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
      const bCreated = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
      return bCreated - aCreated;
    });
  }, [users, currentUser?.uid, userPresence, chatCounts, selectedChat, isActivelyChatting]);

  // Calculate total unread count
  const totalUnreadCount = useMemo(() => {
    return filteredUsers.reduce((total, user) => total + user.unreadCount, 0);
  }, [filteredUsers]);

  // Toggle floating avatars collapsed state
  const toggleAvatars = () => {
    setAvatarsCollapsed(!avatarsCollapsed);
  };

  // Toggle header collapsed state
  const toggleHeader = () => {
    setHeaderCollapsed(!headerCollapsed);
  };

  // Handle logout
  const handleLogout = async () => {
    try {
      await logOut();
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  // Get user display name or email
  const getUserDisplayName = () => {
    if (currentUser?.displayName) {
      return currentUser.displayName;
    }
    if (currentUser?.email) {
      return currentUser.email.split('@')[0];
    }
    return 'User';
  };

  // Get user initials
  const getUserInitials = () => {
    const displayName = getUserDisplayName();
    if (displayName.includes(' ')) {
      const names = displayName.split(' ');
      return (names[0][0] + names[names.length - 1][0]).toUpperCase();
    }
    return displayName.slice(0, 2).toUpperCase();
  };

  // Optimized user fetching with real-time listener
  useEffect(() => {
    if (!currentUser) return;

    // Initialize presence for current user
    initializePresence(currentUser.uid);

    // Listen to users with real-time updates
    const unsubscribeUsers = listenToUsers((allUsers) => {
      setUsers(allUsers);
      setLoading(false);
      
      // Listen to presence for all users
      const userIds = allUsers.map(user => user.id);
      listenToUserPresence(userIds, setUserPresence);
    });

    // Listen to chat counts for unread messages
    const unsubscribeChatCounts = getUserChatsWithCounts(currentUser.uid, (chats) => {
      const chatCountMap = {};
      chats.forEach(chat => {
        const otherUserId = chat.participants.find(id => id !== currentUser.uid);
        if (otherUserId) {
          const chatId = createChatId(currentUser.uid, otherUserId);
          chatCountMap[chatId] = chat;
        }
      });
      setChatCounts(chatCountMap);
    });

    return () => {
      unsubscribeUsers();
      unsubscribeChatCounts();
    };
  }, [currentUser]); // Removed selectedChat dependency

  // Separate effect to set initial selected chat
  useEffect(() => {
    if (!currentUser || users.length === 0 || selectedChat) return;
    
    const otherUsers = users.filter(user => user.id !== currentUser.uid);
    if (otherUsers.length > 0) {
      setSelectedChat(otherUsers[0].id);
    }
  }, [currentUser, users, selectedChat]);

  // Listen to messages for selected chat
  useEffect(() => {
    if (!selectedChat || !currentUser) return;

    const unsubscribe = getChatMessages(
      currentUser.uid, 
      selectedChat, 
      (chatMessages) => {
        setMessages(chatMessages);
      }
    );

    return () => unsubscribe();
  }, [selectedChat, currentUser]);

  // Set document title and handle mobile auto-collapse
  useEffect(() => {
    document.title = "Messages | Chat";
    
    // Auto-collapse on mobile
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setHeaderCollapsed(true);
      } else {
        setHeaderCollapsed(false);
      }
    };

    // Check on mount
    handleResize();
    
    // Listen for resize events
    window.addEventListener('resize', handleResize);
    
    return () => {
      document.title = "Chat";
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showUserMenu && !event.target.closest('.user-menu-container')) {
        setShowUserMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showUserMenu]);

  // Handle chat selection and mark as read
  const handleChatSelect = useCallback(async (userId) => {
    setSelectedChat(userId);
    
    // Mark chat as read when selected
    const chatId = createChatId(currentUser?.uid || '', userId);
    await markChatAsRead(chatId, currentUser?.uid || '');
  }, [currentUser?.uid]);
  
  // Handle quick contact selection and mark as read
  const handleQuickContactSelect = useCallback(async (userId) => {
    setSelectedChat(userId);
    
    // Mark chat as read when selected
    const chatId = createChatId(currentUser?.uid || '', userId);
    await markChatAsRead(chatId, currentUser?.uid || '');
  }, [currentUser?.uid]);

  // Handle sending message with debouncing
  const handleSendMessage = useCallback(async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedChat || sendingMessage) return;

    setSendingMessage(true);
    setIsActivelyChatting(true); // Mark as actively chatting
    const messageToSend = newMessage.trim();
    setNewMessage(''); // Clear input immediately for better UX
    
    try {
      const success = await sendMessage(currentUser.uid, selectedChat, messageToSend);
      if (!success) {
        // Restore message if sending failed
        setNewMessage(messageToSend);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setNewMessage(messageToSend); // Restore message on error
    } finally {
      setSendingMessage(false);
      // Clear actively chatting flag after a brief delay to allow for real-time updates
      setTimeout(() => setIsActivelyChatting(false), 1000);
    }
  }, [newMessage, selectedChat, sendingMessage, currentUser?.uid]);

  // Handle key press in message input
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e);
    }
  };

  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Get user initials
  const getInitials = (displayName, email) => {
    if (displayName) {
      if (displayName.includes(' ')) {
        const names = displayName.split(' ');
        return (names[0][0] + names[names.length - 1][0]).toUpperCase();
      }
      return displayName.slice(0, 2).toUpperCase();
    }
    if (email) {
      return email.slice(0, 2).toUpperCase();
    }
    return 'U';
  };

  // Get selected user details
  const getSelectedUser = useCallback(() => {
    return filteredUsers.find(user => user.id === selectedChat);
  }, [filteredUsers, selectedChat]);

  // Format time difference for "time ago"
  const getTimeAgo = (date) => {
    if (!date) return 'recently';
    
    const now = new Date();
    const createdAt = date.toDate ? date.toDate() : new Date(date);
    const diffInMinutes = Math.floor((now - createdAt) / (1000 * 60));
    
    if (diffInMinutes < 60) return `${diffInMinutes}m`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h`;
    return `${Math.floor(diffInMinutes / 1440)}d`;
  };

  // Format message timestamp
  const formatMessageTime = (timestamp) => {
    if (!timestamp) return '';
    
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  // Handle file selection
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check file size (limit to 50MB)
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      alert('File size must be less than 50MB');
      return;
    }

    // Check file type
    const allowedTypes = ['image/', 'video/'];
    const isAllowed = allowedTypes.some(type => file.type.startsWith(type));
    
    if (!isAllowed) {
      alert('Only images and videos are allowed');
      return;
    }

    setSelectedMedia({
      file,
      type: getMessageType(file),
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      name: file.name,
      size: formatFileSize(file.size)
    });
    setShowMediaPreview(true);
  };

  // Handle media upload and send
  const handleSendMedia = async () => {
    if (!selectedMedia || !selectedChat || isUploading) return;

    setIsUploading(true);
    setIsActivelyChatting(true);
    
    try {
      console.log('Starting media upload process...');
      
      // Upload file to Firebase Storage
      const fileInfo = await uploadFile(
        selectedMedia.file, 
        currentUser.uid, 
        selectedChat,
        setUploadProgress
      );

      console.log('File uploaded successfully:', fileInfo);

      // Send media message
      const success = await sendMediaMessage(
        currentUser.uid, 
        selectedChat, 
        fileInfo, 
        selectedMedia.type
      );

      if (success) {
        console.log('Media message sent successfully');
        setShowMediaPreview(false);
        setSelectedMedia(null);
        setUploadProgress(0);
      } else {
        console.error('Failed to send media message');
        alert('Failed to save media message. Please try again.');
      }
    } catch (error) {
      console.error('Error in handleSendMedia:', error);
      let errorMessage = 'Failed to send media. Please try again.';
      
      if (error.code === 'storage/unauthorized') {
        errorMessage = 'You do not have permission to upload files. Please check your account settings.';
      } else if (error.code === 'storage/canceled') {
        errorMessage = 'Upload was canceled.';
      } else if (error.code === 'storage/quota-exceeded') {
        errorMessage = 'Storage quota exceeded. Please try a smaller file.';
      } else if (error.code === 'storage/invalid-format') {
        errorMessage = 'Invalid file format. Please try a different file.';
      } else if (error.message) {
        errorMessage = `Error: ${error.message}`;
      }
      
      alert(errorMessage);
    } finally {
      setIsUploading(false);
      setTimeout(() => setIsActivelyChatting(false), 1000);
    }
  };

  // Cancel media preview
  const handleCancelMedia = () => {
    if (selectedMedia?.preview) {
      URL.revokeObjectURL(selectedMedia.preview);
    }
    setSelectedMedia(null);
    setShowMediaPreview(false);
    setUploadProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Open file picker
  const handleMediaButtonClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="flex h-screen bg-[#F2F2F2] font-['SF_Pro_Display','-apple-system','BlinkMacSystemFont','Helvetica Neue','Arial','sans-serif']">
      {/* Page Content - Full width without sidebar */}
      <main className="flex-1 bg-[#F2F2F2] overflow-auto h-screen">
        <div className="h-full p-3 md:p-6">
          {/* Combined chat container with rounded corners */}
          <div className="h-full max-w-[900px] mx-auto bg-white rounded-2xl shadow-sm overflow-hidden flex">
            {/* Messages List - Left Panel */}
            <div className={`border-r border-gray-100 flex flex-col h-full transition-all duration-300 ${headerCollapsed ? 'w-[80px]' : 'w-[300px] md:w-[300px]'}`}>
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className={`text-lg font-semibold text-[#1D1D1F] transition-all duration-300 ${headerCollapsed ? 'opacity-0 scale-95 w-0 overflow-hidden' : 'opacity-100 scale-100'}`}>
                    Messages
                  </h2>
                  {!headerCollapsed && totalUnreadCount > 0 && (
                    <div className="bg-red-500 text-white text-xs rounded-full px-2 py-1 font-semibold">
                      {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!headerCollapsed && (
                    <span className="text-sm text-[#86868B] transition-all duration-300 hidden sm:block">
                      {getUserDisplayName()}
                    </span>
                  )}
                  <div className="relative">
                    <button
                      onClick={toggleHeader}
                      className="w-8 h-8 bg-[#3F8AE0] rounded-full flex items-center justify-center text-white font-semibold text-sm hover:bg-[#5095E5] transition-all duration-300 focus:outline-none active:scale-95"
                      title={headerCollapsed ? 'Expand header' : 'Collapse header'}
                    >
                      {getUserInitials()}
                    </button>
                    {headerCollapsed && totalUnreadCount > 0 && (
                      <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold border-2 border-white">
                        {totalUnreadCount > 9 ? '9+' : totalUnreadCount}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              {!headerCollapsed && (
                <div className="px-3 py-1 transition-all duration-300">
                  <div className="relative">
                    <input 
                      type="text" 
                      placeholder="Search" 
                      className="w-full bg-[#F5F5F7] rounded-lg pl-9 pr-3 py-1 text-sm focus:outline-none"
                    />
                    <svg className="w-4 h-4 text-[#86868B] absolute left-3 top-1/2 transform -translate-y-1/2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8"></circle>
                      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                  </div>
                </div>
              )}
              
              <div className="overflow-y-auto flex-1">
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#3F8AE0]"></div>
                  </div>
                ) : users.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                    {!headerCollapsed && (
                      <>
                        <svg className="w-12 h-12 text-[#86868B] mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.196-2.121M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.196-2.121M7 20v-2m5-10a3 3 0 11-6 0 3 3 0 016 0zM12 10a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <p className="text-[#86868B] text-sm">No other users yet</p>
                        <p className="text-[#86868B] text-xs mt-1">Be the first to start conversations!</p>
                      </>
                    )}
                  </div>
                ) : (
                  filteredUsers.map(user => (
                    <div 
                      key={user.id} 
                      className={`${headerCollapsed ? 'px-2 py-3 flex justify-center' : 'px-4 py-3 flex items-start'} hover:bg-[#F5F5F7] transition-colors cursor-pointer ${
                        user.id === selectedChat 
                          ? 'bg-[#F5F5F7]' 
                          : user.unreadCount > 0 
                            ? 'bg-blue-50 border-l-4 border-[#3F8AE0]' 
                            : ''
                      }`}
                      onClick={() => handleChatSelect(user.id)}
                      title={headerCollapsed ? (user.displayName || user.email?.split('@')[0] || 'Anonymous User') : ''}
                    >
                      <div className={`${headerCollapsed ? 'w-8 h-8' : 'w-10 h-10'} bg-[#3F8AE0] rounded-full flex items-center justify-center overflow-hidden ${headerCollapsed ? '' : 'mr-3'} text-white font-semibold relative`}>
                        {user.photoURL ? (
                          <img src={user.photoURL} alt={user.displayName} className="w-full h-full object-cover" />
                        ) : (
                          getInitials(user.displayName, user.email)
                        )}
                        {user.isOnline && (
                          <div className={`absolute ${headerCollapsed ? '-right-0.5 -bottom-0.5 w-2.5 h-2.5' : 'right-0 bottom-0 w-3 h-3'} bg-green-500 rounded-full border-2 border-white`}></div>
                        )}
                        {headerCollapsed && user.unreadCount > 0 && (
                          <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold border-2 border-white">
                            {user.unreadCount > 9 ? '9+' : user.unreadCount}
                          </div>
                        )}
                      </div>
                      {!headerCollapsed && (
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-center mb-1">
                            <h3 className="text-sm font-medium text-[#1D1D1F] truncate">
                              {user.displayName || user.email?.split('@')[0] || 'Anonymous User'}
                            </h3>
                            <div className="flex items-center gap-1">
                              {user.unreadCount > 0 && (
                                <div className="bg-[#3F8AE0] text-white text-xs rounded-full px-2 py-0.5 min-w-[20px] text-center font-semibold">
                                  {user.unreadCount > 99 ? '99+' : user.unreadCount}
                                </div>
                              )}
                              <span className="text-xs text-[#86868B]">
                                {user.lastMessageTime ? getTimeAgo(user.lastMessageTime) : getTimeAgo(user.createdAt)}
                              </span>
                              {user.isOnline && (
                                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                              )}
                            </div>
                          </div>
                          <p className="text-xs text-[#86868B] truncate">
                            {user.lastMessage ? (
                              <span className={user.unreadCount > 0 ? 'font-semibold' : ''}>
                                {user.lastMessage.length > 30 ? `${user.lastMessage.substring(0, 30)}...` : user.lastMessage}
                              </span>
                            ) : user.isOnline ? (
                              'Online'
                            ) : (
                              `Last seen ${getTimeAgo(user.lastActive)}`
                            )}
                          </p>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
            
            {/* Message Content - Right Panel */}
            <div className="flex-1 flex flex-col h-full">
              {selectedChat && getSelectedUser() ? (
                <>
                  {/* Chat Header */}
                  <div className="p-4 border-b border-gray-100 flex items-center">
                    <div className="w-10 h-10 bg-[#3F8AE0] rounded-full flex items-center justify-center overflow-hidden mr-3 text-white font-semibold">
                      {getSelectedUser().photoURL ? (
                        <img src={getSelectedUser().photoURL} alt={getSelectedUser().displayName} className="w-full h-full object-cover" />
                      ) : (
                        getInitials(getSelectedUser().displayName, getSelectedUser().email)
                      )}
                    </div>
                    <div className="flex-1">
                      <h3 className="text-[15px] font-semibold text-[#1D1D1F]">
                        {getSelectedUser().displayName || getSelectedUser().email?.split('@')[0] || 'Anonymous User'}
                      </h3>
                      <div className="text-xs text-[#86868B] flex items-center gap-1">
                        {getSelectedUser().isOnline ? (
                          <>
                            <div className="w-2 h-2 rounded-full bg-green-500"></div>
                            Online
                          </>
                        ) : (
                          `Last seen ${getTimeAgo(getSelectedUser().lastActive)}`
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Chat Messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#F5F5F7]">
                    <div className="flex justify-center">
                      <div className="bg-white/80 backdrop-blur-sm text-xs text-[#86868B] px-3 py-1 rounded-full">
                        Start of conversation with {getSelectedUser().displayName || getSelectedUser().email?.split('@')[0]}
                      </div>
                    </div>
                    
                    {/* Messages */}
                    {messages.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-center">
                        <svg className="w-12 h-12 text-[#86868B] mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                        <p className="text-[#86868B] text-sm">No messages yet</p>
                        <p className="text-[#86868B] text-xs mt-1">Send a message to start the conversation!</p>
                      </div>
                    ) : (
                      <>
                        {messages.map((message, index) => {
                          const isFromCurrentUser = message.senderId === currentUser.uid;
                          const showTimestamp = index === 0 || 
                            (messages[index - 1] && 
                            Math.abs(
                              (message.timestamp?.toDate?.() || new Date(message.timestamp || 0)) - 
                              (messages[index - 1].timestamp?.toDate?.() || new Date(messages[index - 1].timestamp || 0))
                            ) > 5 * 60 * 1000); // Show timestamp if more than 5 minutes apart

                          return (
                            <div key={message.id}>
                              {showTimestamp && (
                                <div className="flex justify-center mb-2">
                                  <span className="text-xs text-[#86868B] bg-white/60 px-2 py-1 rounded-full">
                                    {formatMessageTime(message.timestamp)}
                                  </span>
                                </div>
                              )}
                              <div className={`flex ${isFromCurrentUser ? 'justify-end' : 'justify-start'} mb-2`}>
                                <div className={`max-w-[70%] ${
                                  message.type && message.type !== 'text' ? 'p-1' : 'px-3 py-2'
                                } rounded-2xl ${
                                  isFromCurrentUser 
                                    ? 'bg-[#3F8AE0] text-white rounded-br-md' 
                                    : 'bg-white text-[#1D1D1F] rounded-bl-md shadow-sm'
                                }`}>
                                  {/* Render different message types */}
                                  {message.type === 'image' ? (
                                    <div className="relative">
                                      <img 
                                        src={message.mediaUrl} 
                                        alt="Shared image" 
                                        className="max-w-full h-auto rounded-xl cursor-pointer hover:opacity-90 transition-opacity"
                                        style={{ maxHeight: '300px', minWidth: '200px' }}
                                        onClick={() => window.open(message.mediaUrl, '_blank')}
                                      />
                                      {message.fileName && (
                                        <div className="mt-0.5 px-1 py-0.5">
                                          <p className="text-xs opacity-75">{message.fileName}</p>
                                        </div>
                                      )}
                                    </div>
                                  ) : message.type === 'video' ? (
                                    <div className="relative">
                                      <video 
                                        src={message.mediaUrl} 
                                        controls 
                                        className="max-w-full h-auto rounded-xl"
                                        style={{ maxHeight: '300px', minWidth: '200px' }}
                                      />
                                      {message.fileName && (
                                        <div className="mt-0.5 px-1 py-0.5">
                                          <p className="text-xs opacity-75">{message.fileName}</p>
                                        </div>
                                      )}
                                    </div>
                                  ) : message.type === 'file' ? (
                                    <div className="flex items-center gap-3 px-2 py-1.5 min-w-[200px]">
                                      <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                                        <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{message.fileName}</p>
                                        <p className="text-xs opacity-75">{formatFileSize(message.fileSize || 0)}</p>
                                      </div>
                                      <button 
                                        onClick={() => window.open(message.mediaUrl, '_blank')}
                                        className="p-2 hover:bg-black/10 rounded-lg transition-colors"
                                      >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                      </button>
                                    </div>
                                  ) : (
                                    <p className="text-sm leading-relaxed break-words px-2 py-0.5">
                                      {message.content}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        <div ref={messagesEndRef} />
                      </>
                    )}
                  </div>
                  
                  {/* Message Input */}
                  <div className="p-3 border-t border-gray-100 bg-white">
                    {/* Hidden file input */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,video/*"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    
                    <form onSubmit={handleSendMessage} className="flex items-center">
                      <button 
                        type="button" 
                        onClick={handleMediaButtonClick}
                        className="w-10 h-10 flex items-center justify-center text-[#86868B] hover:text-[#3F8AE0] transition-colors"
                        title="Send photo or video"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"></path>
                          <circle cx="12" cy="13" r="3"></circle>
                        </svg>
                      </button>
                      <div className="flex-1 mx-2">
                        <input 
                          type="text" 
                          value={newMessage}
                          onChange={(e) => setNewMessage(e.target.value)}
                          onKeyPress={handleKeyPress}
                          placeholder={`Message ${getSelectedUser().displayName || getSelectedUser().email?.split('@')[0]}...`}
                          className="w-full bg-white border border-gray-200 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#3F8AE0]"
                          disabled={sendingMessage || isUploading}
                        />
                      </div>
                      <button type="button" className="w-9 h-9 flex items-center justify-center text-[#3F8AE0]">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"></circle>
                          <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
                          <line x1="9" y1="9" x2="9.01" y2="9"></line>
                          <line x1="15" y1="9" x2="15.01" y2="9"></line>
                        </svg>
                      </button>
                      <button 
                        type="submit" 
                        disabled={!newMessage.trim() || sendingMessage || isUploading}
                        className={`w-9 h-9 flex items-center justify-center transition-colors ${
                          newMessage.trim() && !sendingMessage && !isUploading
                            ? 'text-[#3F8AE0] hover:text-[#5095E5]' 
                            : 'text-[#86868B]'
                        }`}
                      >
                        {sendingMessage || isUploading ? (
                          <div className="w-4 h-4 border-2 border-[#3F8AE0] border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="22" y1="2" x2="11" y2="13"></line>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                          </svg>
                        )}
                      </button>
                    </form>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#F5F5F7]">
                  <svg className="w-16 h-16 text-[#86868B] mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <h3 className="text-lg font-semibold text-[#1D1D1F] mb-2">Select a conversation</h3>
                  <p className="text-[#86868B] text-sm">Choose someone from your contacts to start messaging</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
      
      {/* Floating Contact Avatars - Hide on very small screens when header is collapsed */}
      <div className={`fixed bottom-6 right-6 z-20 ${headerCollapsed && isMobile ? 'hidden sm:block' : ''}`}>
        <div className="flex flex-col items-center">
          {/* Avatars - with improved animation */}
          <div className={`flex flex-col-reverse gap-3 mb-3 transition-all duration-300 ease-in-out ${
            avatarsCollapsed 
              ? 'opacity-0 scale-90 translate-y-4 pointer-events-none' 
              : 'opacity-100 scale-100 translate-y-0'
          }`}>
            {/* Show first 3 online users */}
            {filteredUsers.filter(user => user.isOnline).slice(0, 3).map((user, index) => (
              <div key={user.id} className="group relative" style={{ animationDelay: `${index * 50}ms` }}>
                <div className="absolute -left-20 top-1/2 -translate-y-1/2 bg-white px-3 py-1.5 rounded-lg shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                  <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
                    {user.displayName || user.email?.split('@')[0] || 'Anonymous'}
                  </span>
                  <div className="absolute top-1/2 right-0 transform translate-x-1.5 -translate-y-1/2 w-2 h-2 bg-white rotate-45"></div>
                </div>
                <div 
                  className="relative w-12 h-12 bg-[#3F8AE0] rounded-full flex items-center justify-center text-white font-semibold shadow-lg cursor-pointer hover:bg-[#5095E5] transition-all duration-200 active:scale-95 overflow-hidden"
                  onClick={() => handleQuickContactSelect(user.id)}
                >
                  {user.photoURL ? (
                    <img src={user.photoURL} alt={user.displayName} className="w-full h-full object-cover" />
                  ) : (
                    getInitials(user.displayName, user.email)
                  )}
                  <div className="absolute right-0 bottom-0 w-3 h-3 bg-green-500 rounded-full border-2 border-white"></div>
                  {user.unreadCount > 0 && (
                    <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold border-2 border-white">
                      {user.unreadCount > 9 ? '9+' : user.unreadCount}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          
          {/* Toggle button - Apple-styled */}
          <button 
            onClick={toggleAvatars}
            className="w-14 h-14 bg-white rounded-full flex items-center justify-center shadow-lg hover:shadow-xl focus:outline-none transition-all duration-300 transform active:scale-95"
            style={{ 
              boxShadow: "0 5px 15px rgba(0, 0, 0, 0.1)",
              WebkitBackdropFilter: "blur(10px)",
              backdropFilter: "blur(10px)"
            }}
          >
            <svg 
              className={`w-7 h-7 transition-all duration-300 ease-in-out ${
                avatarsCollapsed 
                  ? 'text-[#3F8AE0] rotate-0 scale-100' 
                  : 'text-gray-500 rotate-45 scale-110'
              }`} 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
        </div>
      </div>

      {/* User Menu - Top Right */}
      <div className="fixed top-3 right-3 md:top-6 md:right-6 z-20">
        <div className="relative user-menu-container">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className={`bg-white rounded-full ${isMobile ? 'p-2' : 'p-3'} shadow-lg hover:shadow-xl focus:outline-none transition-all duration-300 transform hover:scale-105 border border-gray-200 flex items-center gap-2`}
            title={`Logged in as ${getUserDisplayName()}`}
          >
            <div className={`${isMobile ? 'w-5 h-5' : 'w-6 h-6'} bg-[#3F8AE0] rounded-full flex items-center justify-center text-white font-semibold text-xs`}>
              {getUserInitials()}
            </div>
            {!isMobile && (
              <svg 
                className={`w-4 h-4 text-[#3F8AE0] transition-transform duration-200 ${showUserMenu ? 'rotate-180' : ''}`} 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            )}
          </button>
          
          {/* User Menu Dropdown */}
          {showUserMenu && (
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1">
              <div className="px-4 py-2 border-b border-gray-100">
                <p className="text-sm font-medium text-[#1D1D1F]">{getUserDisplayName()}</p>
                <p className="text-xs text-[#86868B]">{currentUser?.email}</p>
              </div>
              <button
                onClick={handleLogout}
                className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2"
              >
                <svg 
                  className="w-4 h-4" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                  <polyline points="16 17 21 12 16 7"></polyline>
                  <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Media Preview Modal */}
      {showMediaPreview && selectedMedia && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full mx-4 overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[#1D1D1F]">Send {selectedMedia.type}</h3>
              <button 
                onClick={handleCancelMedia}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
              >
                <svg className="w-5 h-5 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            
            {/* Media Preview */}
            <div className="p-4">
              {selectedMedia.type === 'image' && selectedMedia.preview ? (
                <img 
                  src={selectedMedia.preview} 
                  alt="Preview" 
                  className="w-full h-auto max-h-80 object-contain rounded-lg bg-gray-50"
                />
              ) : selectedMedia.type === 'video' ? (
                <div className="flex items-center justify-center h-60 bg-gray-50 rounded-lg">
                  <div className="text-center">
                    <svg className="w-16 h-16 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <p className="text-sm text-gray-600">Video ready to send</p>
                  </div>
                </div>
              ) : null}
              
              {/* File Info */}
              <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{selectedMedia.name}</p>
                    <p className="text-xs text-gray-500">{selectedMedia.size}</p>
                  </div>
                  <div className="text-xs text-gray-500 capitalize">
                    {selectedMedia.type}
                  </div>
                </div>
              </div>
              
              {/* Upload Progress */}
              {isUploading && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-600">Uploading...</span>
                    <span className="text-sm text-gray-600">{Math.round(uploadProgress)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-[#3F8AE0] h-2 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    ></div>
                  </div>
                </div>
              )}
            </div>
            
            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-100 flex items-center justify-end gap-3">
              <button 
                onClick={handleCancelMedia}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                disabled={isUploading}
              >
                Cancel
              </button>
              <button 
                onClick={handleSendMedia}
                disabled={isUploading}
                className="px-6 py-2 text-sm font-medium text-white bg-[#3F8AE0] rounded-lg hover:bg-[#5095E5] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isUploading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Uploading...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="22" y1="2" x2="11" y2="13"></line>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                    Send
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Messages;
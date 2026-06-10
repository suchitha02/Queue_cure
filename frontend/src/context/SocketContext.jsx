import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

// If VITE_BACKEND_URL is empty, Socket.IO connects to same origin (Vite proxy)
// In production set this to your Railway backend URL
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || undefined;

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [queue, setQueue] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    const socket = io(BACKEND_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join_queue');
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('queue_snapshot', (data) => {
      // Stamp the exact moment this snapshot was received.
      // PatientView uses this to subtract elapsed time from estimatedWaitMs
      // so the countdown actually ticks down every second.
      setQueue({ ...data, receivedAt: Date.now() });
    });

    socket.on('patient_added', ({ tokenLabel, name }) => {
      showToast(`Token ${tokenLabel} assigned to ${name}`, 'success');
    });
    socket.on('error_msg', ({ message }) => {
      showToast(message, 'error');
    });

    return () => socket.disconnect();
  }, []);

  function showToast(message, type = 'info') {
    setToast({ message, type, id: Date.now() });
    setTimeout(() => setToast(null), 3500);
  }

  function emit(event, data) {
    if (socketRef.current) socketRef.current.emit(event, data);
  }

  return (
    <SocketContext.Provider value={{ connected, queue, emit, toast, showToast }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}

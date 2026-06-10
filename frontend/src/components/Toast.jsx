import { useSocket } from '../context/SocketContext';

export default function Toast() {
  const { toast } = useSocket();
  if (!toast) return null;
  return (
    <div className={`toast toast-${toast.type}`} key={toast.id}>
      <span className="toast-icon">
        {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ'}
      </span>
      {toast.message}
    </div>
  );
}

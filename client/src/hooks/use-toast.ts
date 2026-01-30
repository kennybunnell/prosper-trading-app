import { useState, useCallback } from 'react';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
  duration?: number;
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastOptions[]>([]);

  const toast = useCallback((options: ToastOptions) => {
    // For now, just use console.log
    // In production, this would integrate with a toast UI library
    console.log('[Toast]', options.title, options.description);
    
    // Also show browser alert for important errors
    if (options.variant === 'destructive') {
      alert(`${options.title}: ${options.description}`);
    } else {
      alert(`${options.title}${options.description ? ': ' + options.description : ''}`);
    }
    
    setToasts(prev => [...prev, options]);
    
    // Auto-dismiss after duration
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t !== options));
    }, options.duration || 5000);
  }, []);

  return { toast, toasts };
}

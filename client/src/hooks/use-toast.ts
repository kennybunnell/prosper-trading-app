import { toast as sonnerToast } from 'sonner';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
  duration?: number;
}

export function useToast() {
  const toast = (options: ToastOptions) => {
    const { title, description, variant, duration } = options;
    
    // Use sonner toast instead of browser alerts
    if (variant === 'destructive') {
      sonnerToast.error(title, {
        description,
        duration: duration || 5000,
      });
    } else {
      sonnerToast(title, {
        description,
        duration: duration || 5000,
      });
    }
  };

  return { toast };
}

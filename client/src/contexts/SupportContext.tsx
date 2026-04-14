import { createContext, useContext, useState, ReactNode } from "react";

interface SupportContextValue {
  isOpen: boolean;
  openSupport: () => void;
  closeSupport: () => void;
}

const SupportContext = createContext<SupportContextValue>({
  isOpen: false,
  openSupport: () => {},
  closeSupport: () => {},
});

export function SupportProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <SupportContext.Provider
      value={{
        isOpen,
        openSupport: () => setIsOpen(true),
        closeSupport: () => setIsOpen(false),
      }}
    >
      {children}
    </SupportContext.Provider>
  );
}

export function useSupportWidget() {
  return useContext(SupportContext);
}
